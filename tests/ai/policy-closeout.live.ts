import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { convertToModelMessages } from "ai";
import { createOperationsAgent } from "@/app/_ai/agents/operations-agent";
import { createConciergeAgent } from "@/app/_ai/agents/concierge-agent";
import { authorizeOperationsStaff } from "@/app/_ai/operations-auth";
import { readOperationsRequest } from "@/app/_ai/operations-request";
import { createPolicySearchService, createPolicySearchTool } from "@/app/_ai/tools/policy-search";
import { embedPolicyQuery } from "@/app/_ai/providers/policy-embedding-model";
import { matchPolicyChunks } from "@/app/_ai/policies/policy-repository";
import { createProxyAwareFetch } from "@/app/_lib/server-fetch";
import type { PolicyRpcClient } from "@/app/_ai/policies/policy-repository";
import { verifyPolicyAccess } from "../../scripts/verify-policy-access.mjs";
import { loadPolicyDocuments, parsePolicyDocument } from "../../scripts/policy-content.mjs";
import { createPolicyIngestionPlan, readPolicyRemoteState, hydrateReusablePolicyEmbeddings,
  generatePolicyEmbeddings } from "../../scripts/ingest-policies.mjs";
import { embedMany } from "ai";

const roles = ["ordinary", "staff", "admin"] as const;
const accounts = new Map<string, { id: string; client: SupabaseClient; token: string }>();
const createdIds: string[] = [];
const report: Record<string, unknown> = { date: new Date().toISOString(), roles: {}, answers: [] };
let service: SupabaseClient;
let guest: SupabaseClient;
let knownVector: number[];
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

beforeAll(async () => {
  for (const file of [".env.development.local", ".env.local"]) {
    try { process.loadEnvFile(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const url = process.env.SUPABASE_URL!;
  // Deliberately tied to the reviewed development project, never production.
  expect(new URL(url).hostname).toBe("tupdbxiujsfaifqulgmt.supabase.co");
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY)!;
  const options = { ...clientOptions, global: { fetch: createProxyAwareFetch() } };
  service = createClient(url, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, options);
  guest = createClient(url, key, options);
  const vectorResult = await service.from("policy_chunks").select("embedding")
    .eq("document_id", "exception-handling-sop").limit(1).single();
  expect(vectorResult.error).toBeNull();
  knownVector = typeof vectorResult.data!.embedding === "string"
    ? JSON.parse(vectorResult.data!.embedding) : vectorResult.data!.embedding;
  for (const role of roles) {
    const email = `feature04-${randomUUID()}@example.invalid`;
    const password = `${randomUUID()}Aa9!`;
    const created = await service.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: role === "ordinary" ? {} : { role },
      // A user-editable role must not confer staff access.
      user_metadata: role === "ordinary" ? { role: "admin" } : {},
    });
    expect(created.error?.message ?? null).toBeNull();
    createdIds.push(created.data.user!.id);
    const client = createClient(url, key, options);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    expect(signedIn.error?.message ?? null).toBeNull();
    accounts.set(role, { id: created.data.user!.id, client, token: signedIn.data.session!.access_token });
  }
});

afterAll(async () => {
  const cleanupFailures: string[] = [];
  for (const id of createdIds) {
    const account = [...accounts.values()].find((item) => item.id === id);
    if (account) await account.client.auth.signOut();
    const removed = await service.auth.admin.deleteUser(id);
    if (removed.error) cleanupFailures.push(id);
  }
  report.temporaryAccountsCreated = createdIds.length;
  report.temporaryAccountsRemoved = createdIds.length - cleanupFailures.length;
  await mkdir(".next/feature04-evidence", { recursive: true });
  // No identities, tokens, credentials, or vectors are written to the report.
  await writeFile(".next/feature04-evidence/live-closeout.json", JSON.stringify(report, null, 2));
  await writeFile(`.next/feature04-evidence/live-closeout-${String(report.date).replace(/[:.]/g, "-")}.json`, JSON.stringify(report, null, 2));
  expect(cleanupFailures).toEqual([]);
});

it("verifies real anonymous table and RPC isolation against an existing staff corpus", async () => {
  report.guest = await verifyPolicyAccess({ guestClient: guest, serviceClient: service });
});

it("rejects absent and invalid bearer credentials at the BFF boundary", async () => {
  for (const token of [null, "invalid-session"]) {
    const authorization = await authorizeOperationsStaff(new Request("https://bff.example.com", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }));
    expect(authorization).toMatchObject({ ok: false, status: 401 });
  }
  report.invalidSessionsDenied = true;
});

it("embeds only one changed public chunk and reuses the other real vector without writing policies", async () => {
  const { config, documents } = await loadPolicyDocuments();
  const remote = await readPolicyRemoteState(service);
  const unchanged = createPolicyIngestionPlan(documents, remote, config);
  expect(unchanged.summary).toMatchObject({ unchanged: 7, embed: 0, update: 0 });
  const path = "content/policies/public/pet-policy.md";
  const source = await readFile(path, "utf8");
  const edited = parsePolicyDocument(source.replace("version: 1", "version: 2")
    .replace("A USD 25 cleaning fee", "A cleaning fee of USD 25"), path, config);
  const plan = createPolicyIngestionPlan(documents.map((doc) => doc.sourcePath === path ? edited : doc), remote, config);
  expect(plan.summary).toMatchObject({ update: 1, unchanged: 6, embed: 1, reuse: 1 });
  await hydrateReusablePolicyEmbeddings(service, plan, config);
  let embeddedValues = 0;
  await generatePolicyEmbeddings(plan, config, process.env.GOOGLE_GENERATIVE_AI_API_KEY!, {
    embedValues: async (options: Parameters<typeof embedMany>[0]) => {
      embeddedValues += options.values.length;
      return embedMany(options);
    },
    env: process.env,
  });
  expect(embeddedValues).toBe(1);
  const changed = plan.documents.find((doc: { sourcePath: string }) => doc.sourcePath === path)!;
  expect(changed.chunks.every((chunk: { embedding?: number[] }) => chunk.embedding?.length === 768)).toBe(true);
  report.incrementalEmbedding = { ...plan.summary, actualEmbeddedValues: embeddedValues, databaseWrites: 0 };
});

it.each(roles)("verifies a signed-in %s identity through tables, RPC, and the BFF authorizer", async (role) => {
  const account = accounts.get(role)!;
  const expectedStaff = role !== "ordinary";
  const documents = await account.client.from("policy_documents").select("document_id,scope,is_current");
  const chunks = await account.client.from("policy_chunks").select("chunk_id").eq("document_id", "exception-handling-sop");
  const matches = await account.client.rpc("match_policy_chunks", {
    query_text: "exception handling SOP", query_embedding: knownVector,
    result_count: 6, minimum_similarity: 0,
  });
  expect(documents.error).toBeNull(); expect(chunks.error).toBeNull(); expect(matches.error).toBeNull();
  expect(documents.data!.filter((row) => row.scope === "staff")).toHaveLength(expectedStaff ? 1 : 0);
  expect(chunks.data).toHaveLength(expectedStaff ? 4 : 0);
  const staffMatches = matches.data.filter((row: { scope: string }) => row.scope === "staff").length;
  expect(staffMatches > 0).toBe(expectedStaff);
  const authorization = await authorizeOperationsStaff(new Request("https://bff.example.com", {
    headers: { authorization: `Bearer ${account.token}` },
  }));
  expect(authorization.ok).toBe(expectedStaff);
  if (!authorization.ok) expect(authorization.status).toBe(403);
  // Empty invalid payload proves execute permission is denied, without a mutation.
  const sync = await account.client.rpc("sync_policy_document", { document_payload: {}, chunk_payloads: [] });
  expect(sync.error?.code).toBe("42501");
  (report.roles as Record<string, unknown>)[role] = {
    documents: documents.data!.length, staffChunks: chunks.data!.length,
    staffRpcMatches: staffMatches, bffAllowed: authorization.ok, syncDenied: true,
  };
});

it.each([
  ["客人要求免除临时取消费，我应如何处理？只解释流程，不创建任何记录。", "Administrator escalation"],
  ["严重过敏的异常处理流程是什么？只解释流程。", "High-priority cases"],
])("checks live staff evidence facets: %s", async (question, section) => {
  const retrieve = createPolicySearchService({ client: accounts.get("staff")!.client, allowedScopes: ["public", "staff"] });
  const result = await retrieve({ question });
  const facets = (report.staffFacets ??= []) as unknown[];
  facets.push({ question, status: result.status, citations: result.citations });
  expect(result.status).toBe("grounded");
  expect(result.citations.some((citation) => citation.scope === "staff" && citation.section === section)).toBe(true);
  if (section === "Administrator escalation") {
    expect(result.citations.some((citation) => citation.documentId === "cancellation-refund")).toBe(true);
  }
});

it.each([
  ["guest", "取消收费政策是什么？", "cancellation-refund"],
  ["staff", "取消收费政策是什么？", "cancellation-refund"],
  ["guest", "需要提前72小时申请无障碍支持吗？", "accessibility"],
  ["staff", "需要提前72小时申请无障碍支持吗？", "accessibility"],
])("checks live %s answer fidelity: %s", async (surface, question, documentId) => {
  const messages = [{ role: "user" as const, parts: [{ type: "text" as const, text: question }] }];
  const parsed = await readOperationsRequest(new Request("https://bff.example.com", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }),
  }));
  expect(parsed.ok && parsed.currentPolicyQuestion).toBe(question);
  const account = accounts.get("staff")!;
  const diagnostics: unknown[] = [];
  const guestPolicyTool = createPolicySearchTool({
    client: guest,
    embedQuery: async (query) => {
      try {
        const vector = await embedPolicyQuery(query);
        diagnostics.push({ stage: "embedding", dimensions: vector.length });
        return vector;
      } catch (error) {
        diagnostics.push({ stage: "embedding", failed: true,
          statusCode: (error as { statusCode?: number }).statusCode ?? null });
        throw error;
      }
    },
    search: async (input) => {
      const matches = await matchPolicyChunks(input);
      diagnostics.push({ stage: "retrieval", matches: matches.map((match) => ({
        documentId: match.citation.documentId, section: match.citation.section,
        similarity: match.semanticSimilarity,
      })) });
      return matches;
    },
  });
  const policyOnlyClient = {
    from: () => { throw new Error("Business tables are disabled in the live policy regression."); },
    rpc: ((name, parameters) => {
      if (name !== "match_policy_chunks") throw new Error("Only read-only policy retrieval is allowed.");
      return account.client.rpc(name, parameters);
    }) satisfies PolicyRpcClient["rpc"],
  };
  const agent = surface === "guest"
    ? createConciergeAgent({ currentPolicyQuestion: question, policySearchTool: guestPolicyTool })
    : createOperationsAgent({ client: policyOnlyClient, actorId: account.id, currentPolicyQuestion: question });
  const result = await agent.generate({
    messages: await convertToModelMessages(messages), timeout: { totalMs: 100_000 },
  });
  const policyResults = result.steps.flatMap<{ toolName: string; output: unknown }>((step) => step.toolResults)
    .filter((item) => item.toolName === "searchHotelPolicies");
  const output = policyResults[0]?.output as { citations?: Array<{ documentId: string }> };
  (report.answers as unknown[]).push({ surface, question, text: result.text,
    citations: output?.citations, policyCalls: policyResults.length, diagnostics });
  expect(policyResults).toHaveLength(1);
  expect(output.citations?.some((item) => item.documentId === documentId)).toBe(true);
  if (documentId === "cancellation-refund") {
    expect(result.text).toMatch(/(?:不足|少于|小于)\s*48\s*(?:个)?小时/);
    expect(result.text).not.toMatch(/48\s*(?:个)?小时以?内/);
  } else {
    expect(result.text).toMatch(/建议|尽早|最好/);
    expect(result.text).toMatch(/72/);
    expect(result.text).not.toMatch(/不会(?:被)?(?:自动)?拒绝|不(?:会)?自动拒绝|保证.{0,8}(?:接受|安排)/);
  }
});

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { preparePolicyQuery } from "@/app/_ai/policies/policy-query-privacy";
import { policyEvidencePlan } from "@/app/_ai/policies/policy-evidence-plan";
import { dashscopeBaseURL, dashscopeFetch } from "../../scripts/dashscope-client.mjs";
import { loadPolicyDocuments } from "../../scripts/policy-content.mjs";

it("prepares real sanitized calibration vectors without reading or writing a database", async () => {
  const maxCNY = Number(process.env.AI_POLICY_CALIBRATION_MAX_CNY);
  if (!Number.isFinite(maxCNY) || maxCNY <= 0 || maxCNY > 1) throw new Error("Explicit calibration budget required (0–1 CNY).");
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY required.");
  const corpus = JSON.parse(await readFile("output/dashscope-policy-migration/prepared-corpus.json", "utf8"));
  const { config, documents } = await loadPolicyDocuments({ env: { ...process.env, AI_POLICY_PROVIDER: "dashscope" } });
  expect(corpus.project).toBe("fadfglcobmxxsawxlmpb"); expect(corpus.model).toBe("text-embedding-v4");
  expect(corpus.payloadHash).toBe(createHash("sha256").update(JSON.stringify(corpus.payloads)).digest("hex"));
  expect(corpus.payloads.map((item: any) => item.document_payload.content_hash)).toEqual(documents.map((item: any) => item.contentHash));
  const cases = JSON.parse(await readFile("tests/ai/policy-rag-cases.json", "utf8"));
  const prepared = cases.map((row: any) => { const prepared = preparePolicyQuery(row.query, { allowStaffScope: row.caller === "staff" }); return { ...row, prepared, facets: prepared.searchable ? policyEvidencePlan(prepared.sanitized, row.caller === "staff") : [] }; });
  const values = [...new Set<string>(prepared.flatMap((row: any) => row.facets.map((facet: any) => facet.query)))];
  const allowance = values.reduce((sum, value) => sum + Buffer.byteLength(value, "utf8") * 2 + 64, 0) * 0.5 / 1_000_000;
  if (allowance > maxCNY) throw new Error("Calibration allowance exceeds budget.");
  const baseURL = dashscopeBaseURL();
  const provider = createOpenAI({ apiKey, baseURL, fetch: dashscopeFetch(globalThis.fetch, baseURL) });
  const vectors: Record<string, number[]> = {};
  let tokens = 0;
  for (let offset = 0; offset < values.length; offset += 10) {
    const batch = values.slice(offset, offset + 10);
    const result = await embedMany({ model: provider.embedding(config.embedding.model), values: batch, maxParallelCalls: 1, maxRetries: 0, abortSignal: AbortSignal.timeout(30_000), providerOptions: { openai: { dimensions: 768 } } });
    expect(result.embeddings).toHaveLength(batch.length);
    result.embeddings.forEach((vector, index) => { expect(vector).toHaveLength(768); expect(vector.every(Number.isFinite)).toBe(true); vectors[batch[index]] = vector; });
    tokens += result.usage.tokens;
  }
  await mkdir("output/dashscope-policy-migration", { recursive: true });
  await writeFile("output/dashscope-policy-migration/calibration-vectors.json", JSON.stringify({ schemaVersion: 1, corpusHash: corpus.payloadHash, model: config.embedding.model, cases: prepared, vectors, inputTokens: tokens, estimatedCNY: tokens * 0.5 / 1_000_000 }), "utf8");
  console.log(JSON.stringify({ cases: prepared.length, uniqueQueries: values.length, blockedBeforeEmbedding: prepared.filter((row: any) => !row.prepared.searchable).length, inputTokens: tokens, estimatedCNY: tokens * 0.5 / 1_000_000, databaseWrites: 0 }));
});

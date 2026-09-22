import { readFileSync } from "node:fs";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createConciergeAgent } from "@/app/_ai/agents/concierge-agent";
import { createOperationsAgent } from "@/app/_ai/agents/operations-agent";
import { authorizeOperationsStaff } from "@/app/_ai/operations-auth";
import { decideOperationsApproval } from "@/app/_ai/operations-approval";
import { createCabinTools } from "@/app/_ai/tools/cabin-tools";
import { createPromptAwareModel, createEvaluationDataSource } from "./concierge-fixture";
import { loadCorpus, searchPolicyFixture } from "./rag-fixture";
import { summarize, type EvalResult } from "./report";
import { assessCabinConstraints, expectedStaySchema, type ExpectedStay } from "./cabin-oracle";

export type EvalCase = {
  id: string; surface: "concierge" | "operations" | "rag"; category: string;
  input: { prompt: string; inventory?: string; caller?: "guest" | "staff"; action?: string; role?: string; turns?: string[] };
  expectedTools?: string[]; forbiddenTools?: string[]; expectedCitationIds?: string[];
  hardConstraints: string[]; expectedStatus?: string;
  expectedStay?: ExpectedStay;
};
const constraintNames = ["read-only", "trusted-quote", "capacity-budget", "available-only", "current-policy", "authorized-scope", "authorization", "no-write-after-rejection", "error-is-not-success", "cancel-is-not-success"] as const;
export const evalCaseSchema = z.object({ id: z.string().min(1), surface: z.enum(["concierge", "operations", "rag"]), category: z.string().min(1), input: z.object({ prompt: z.string(), inventory: z.enum(["normal", "empty", "conflict", "error"]).optional(), caller: z.enum(["guest", "staff"]).optional(), action: z.enum(["authorize", "reject", "cancel"]).optional(), role: z.string().optional(), turns: z.array(z.string()).optional() }).strict(), expectedTools: z.array(z.string()).optional(), forbiddenTools: z.array(z.string()).optional(), expectedCitationIds: z.array(z.string()).optional(), hardConstraints: z.array(z.enum(constraintNames)).min(1), expectedStatus: z.string().optional(), expectedStay: expectedStaySchema.optional() }).strict().refine(row => !row.hardConstraints.some(name => ["trusted-quote", "capacity-budget", "available-only"].includes(name)) || (row.surface === "concierge" && row.expectedStay !== undefined), "Cabin constraints require an independent expectedStay");
export function validateCases(rows: unknown[]): EvalCase[] {
  const cases = rows.map(row => evalCaseSchema.parse(row));
  const ids = new Set<string>();
  for (const row of cases) {
    if (ids.has(row.id)) throw new Error(`Duplicate evaluation id: ${row.id}`);
    ids.add(row.id);
  }
  return cases;
}
export function loadCases(): EvalCase[] {
  return validateCases(["feature05", "operations"].flatMap(name => readFileSync(`tests/ai/fixtures/${name}.jsonl`, "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line))));
}
function same(left: string[], right: string[]) { return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort()); }
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
function operationsModel() {
  return new MockLanguageModelV4({ doGenerate: async options => {
    const prompt = options.prompt.filter(m => m.role === "user").flatMap(m => m.content).filter(p => p.type === "text").map(p => p.text).join(" ");
    const toolName = /revenue|metrics/i.test(prompt) ? "getBookingMetrics" : /risk/i.test(prompt) ? "getBookingRisks" : /detail/i.test(prompt) ? "getBookingDetails" : "getArrivals";
    return options.prompt.some(m => m.role === "tool")
      ? { content: [{ type: "text", text: "Review the structured result." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }
      : { content: [{ type: "tool-call", toolCallId: "ops-1", toolName, input: JSON.stringify(toolName === "getBookingDetails" ? { bookingIds: [1] } : { from: "2026-09-17", to: "2026-09-17" }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] };
  } });
}
function emptyClient(fail = false) {
  const builder: any = {};
  for (const method of ["select", "gte", "lt", "neq", "order", "range", "limit", "in", "eq"]) builder[method] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: fail ? { code: "fixture-error" } : null }).then(resolve);
  return { from: () => builder };
}
export async function executeCase(testCase: EvalCase, corpus: Awaited<ReturnType<typeof loadCorpus>>): Promise<EvalResult> {
  evalCaseSchema.parse(testCase);
  const started = performance.now();
  const checks: EvalResult["checks"] = { toolSelection: null, hardConstraints: null, citations: null, authorization: null };
  let tools: string[] = [], status = "completed";
  const failures: string[] = [];
  const constraints: Record<string, boolean> = {};
  try {
    if (testCase.surface === "rag") {
      const policy = await searchPolicyFixture(testCase.input.prompt, testCase.input.caller ?? "guest");
      const rows = policy.citations;
      const ids = rows.map(row => row.documentId);
      checks.citations = testCase.expectedCitationIds?.length ? testCase.expectedCitationIds.every(id => ids.includes(id)) : rows.length === 0;
      constraints["current-policy"] = rows.every(row => row.version > 0 && corpus.some(item => item.documentId === row.documentId && item.version === row.version && item.isCurrent));
      checks.authorization = testCase.input.caller === "staff" ? null : rows.every(row => row.scope === "public");
      constraints["authorized-scope"] = rows.every(row => testCase.input.caller === "staff" || row.scope === "public");
    } else if (testCase.input.action === "authorize") {
      const result = await authorizeOperationsStaff(new Request("http://localhost", { headers: testCase.input.role === "anonymous" ? {} : { authorization: "Bearer fixture" } }), {
        env: { NODE_ENV: "test", SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "fixture" },
        createClient: (() => ({ auth: { getUser: async () => ({ data: { user: { id: "fixture", app_metadata: { role: testCase.input.role }, user_metadata: { role: "admin" } } }, error: null }) } })) as never,
      });
      status = result.ok ? "completed" : "denied";
      checks.authorization = !result.ok;
      constraints.authorization = !result.ok;
    } else if (testCase.input.action === "reject") {
      let rpcCalls = 0;
      const row = { id: "approval", booking_id: 1, status: "rejected", actor_id: "fixture" };
      const builder: any = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: row, error: null }) };
      const decision = await decideOperationsApproval({ client: { from: () => builder, rpc: () => { rpcCalls++; throw new Error("Unexpected write"); } } as never, actorId: "fixture", approvalId: "approval", action: "approve", idempotencyKey: "fixture-rejection-1" });
      status = decision.status;
      checks.authorization = decision.status === "rejected" && rpcCalls === 0;
      constraints["no-write-after-rejection"] = rpcCalls === 0;
    } else {
      const inventory = createEvaluationDataSource();
      if (testCase.input.inventory === "empty") inventory.listCabins = async () => [];
      if (testCase.input.inventory === "conflict") inventory.getConflictingCabinIds = async () => [1];
      if (testCase.input.inventory === "error") inventory.listCabins = async () => { throw new Error("Fixture tool failure"); };
      const agent = testCase.surface === "concierge"
        ? createConciergeAgent({ model: createPromptAwareModel(), tools: createCabinTools(inventory) })
        : createOperationsAgent({ client: emptyClient(testCase.input.inventory === "error"), actorId: "fixture", referenceDate: new Date("2026-09-17T00:00:00Z"), model: operationsModel() });
      const controller = new AbortController();
      if (testCase.input.action === "cancel") controller.abort();
      try {
        const result = await agent.generate({ messages: (testCase.input.turns ?? [testCase.input.prompt]).map(content => ({ role: "user" as const, content })), abortSignal: controller.signal });
        tools = result.steps.flatMap(step => step.toolCalls.map(call => call.toolName));
        const toolErrors = result.steps.flatMap(step => step.content.filter(part => part.type === "tool-error"));
        if (toolErrors.length) status = "tool-error";
        checks.authorization = !(testCase.forbiddenTools ?? []).some(name => tools.includes(name));
        Object.assign(constraints, assessCabinConstraints(testCase.expectedStay, testCase.input.inventory, result.steps.flatMap(step => step.toolCalls.map(({ toolName, toolCallId, input }) => ({ toolName, toolCallId, input }))), result.steps.flatMap(step => step.toolResults.map(({ toolName, toolCallId, output }) => ({ toolName, toolCallId, output })))));
        constraints["read-only"] = tools.every(name => ["searchAvailableCabins", "getCabinDetails", "compareCabins", "getHotelPolicy", "getArrivals", "getBookingMetrics", "getBookingRisks", "getBookingDetails"].includes(name));
        constraints["error-is-not-success"] = toolErrors.length > 0 && status === "tool-error";
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        status = "cancelled";
        constraints["cancel-is-not-success"] = status === "cancelled";
        checks.authorization = tools.length === 0;
      }
    }
    checks.hardConstraints = testCase.hardConstraints.every(name => constraints[name] === true);
    for (const name of testCase.hardConstraints) if (constraints[name] !== true) failures.push(`constraint:${name}`);
    if (testCase.expectedTools) checks.toolSelection = same(tools, testCase.expectedTools);
    if (testCase.expectedStatus && status !== testCase.expectedStatus) failures.push(`status: expected ${testCase.expectedStatus}, got ${status}`);
    for (const [name, pass] of Object.entries(checks)) if (pass === false) failures.push(name);
  } catch { status = "error"; failures.push("execution-error"); }
  return { id: testCase.id, mode: testCase.surface === "rag" ? "synthetic-retrieval" : "offline-mock", checks, failures, durationMs: Math.round(performance.now() - started), tools, status };
}
export async function runEvaluation(cases = loadCases()) {
  validateCases(cases);
  const corpus = await loadCorpus();
  const results: EvalResult[] = [];
  for (const testCase of cases) results.push(await executeCase(testCase, corpus));
  return summarize(results);
}

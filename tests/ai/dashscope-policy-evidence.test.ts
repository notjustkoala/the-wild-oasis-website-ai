import { createPolicySearchService } from "@/app/_ai/tools/policy-search";
import { createProxyAwareFetch } from "@/app/_lib/server-fetch";
import { dashscopeTransportEnvironment } from "../../scripts/dashscope-client.mjs";
import type { PolicyMatch } from "@/app/_ai/policies/policy-repository";

function match(documentId: string, section: string, scope: "public" | "staff" = "public", similarity = 0.65): PolicyMatch {
  return { citation: { documentId, section, title: "Governed policy", version: 1, effectiveDate: "2026-08-30", excerpt: "Hotel staff must confirm the request.", scope }, semanticSimilarity: similarity, rrfScore: 0.03 };
}
beforeEach(() => { vi.stubEnv("AI_PROVIDER", "dashscope"); vi.stubEnv("AI_POLICY_PROVIDER", "dashscope"); });
afterEach(() => { vi.unstubAllEnvs(); });

it("retrieves both breakfast price policy and allergy confirmation evidence", async () => {
  const queries: string[] = [];
  const service = createPolicySearchService({ client: { rpc: vi.fn() }, embedQuery: async () => Array(768).fill(0.01), search: async ({ queryText }) => {
    queries.push(queryText);
    return queryText.includes("optional breakfast") ? [match("breakfast-dietary", "Optional breakfast"), match("pet-policy", "Fee and conduct", "public", 0.99)] : [match("breakfast-dietary", "Dietary requests")];
  } });
  const result = await service({ question: "早餐多少钱，饮食过敏能保证安排吗？" });
  expect(result.status).toBe("grounded");
  expect(result.citations.map(row => row.section)).toEqual(["Optional breakfast", "Dietary requests"]);
  expect(queries).toHaveLength(2); expect(result.citations.some(row => row.documentId === "pet-policy")).toBe(false);
});

it("joins public allergy policy and authorized staff SOP without sending user identity", async () => {
  const embedQuery = vi.fn(async () => Array(768).fill(0.01));
  const service = createPolicySearchService({ client: { rpc: vi.fn() }, allowedScopes: ["public", "staff"], embedQuery, search: async ({ queryText }) => queryText.includes("exception handling") ? [match("exception-handling-sop", "High-priority cases", "staff")] : [match("breakfast-dietary", "Dietary requests")] });
  const result = await service({ question: "严重过敏例外应该如何升级处理？" });
  expect(result.status).toBe("grounded"); expect(result.citations.map(row => row.documentId)).toEqual(expect.arrayContaining(["breakfast-dietary", "exception-handling-sop"]));
  expect(embedQuery.mock.calls).toHaveLength(2);
});

it("fails closed on an unauthorized staff result before topic filtering", async () => {
  const service = createPolicySearchService({ client: { rpc: vi.fn() }, embedQuery: async () => Array(768).fill(0.01), search: async () => [match("pet-policy", "Eligible pets"), match("exception-handling-sop", "Internal", "staff")] });
  expect(await service({ question: "宠物政策是什么？" })).toMatchObject({ status: "insufficient-evidence", citations: [] });
});

it("requires staff evidence for a fee waiver instead of answering from the refund rule", async () => {
  const service = createPolicySearchService({ client: { rpc: vi.fn() }, allowedScopes: ["public", "staff"], embedQuery: async () => Array(768).fill(0.01), search: async () => [match("cancellation-refund", "Review and processing")] });
  expect(await service({ question: "取消费用减免流程是什么？" })).toMatchObject({ status: "insufficient-evidence", citations: [] });
});

it("does not inherit the old Google/OAuth proxy for DashScope", () => {
  const env = dashscopeTransportEnvironment({ NODE_ENV: "test", HTTPS_PROXY: "http://127.0.0.1:9", AI_HTTPS_PROXY: "http://127.0.0.1:9" });
  const nativeFetch = vi.fn() as unknown as typeof globalThis.fetch;
  const createProxyAgent = vi.fn();
  expect(createProxyAwareFetch(env, { nativeFetch, createProxyAgent })).toBe(nativeFetch);
  expect(createProxyAgent).not.toHaveBeenCalled();
});

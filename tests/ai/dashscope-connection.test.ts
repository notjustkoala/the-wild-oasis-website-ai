import { createAgentUIStreamResponse } from "ai";
import { resolveConciergeModel, getConciergeProviderConfigurationError } from "@/app/_ai/providers/concierge-model";
import { resolveBookingInsightModel } from "@/app/_ai/providers/booking-insight-model";
import { resolveOperationsProviderConfiguration } from "@/app/_ai/providers/operations-model";
import { createConciergeAgent } from "@/app/_ai/agents/concierge-agent";
import { createCabinTools, type ConciergeInventoryDataSource } from "@/app/_ai/tools/cabin-tools";
import { generateBookingInsight } from "@/app/_ai/booking-insight-generator";
import { createRunObserver } from "@/app/_ai/observability/run";
import { embedPolicyQuery } from "@/app/_ai/providers/policy-embedding-model";
import { matchPolicyChunks } from "@/app/_ai/policies/policy-repository";
import { dashscopeBaseURL, DEFAULT_DASHSCOPE_BASE_URL } from "../../scripts/dashscope-client.mjs";
import { loadPolicyDocuments } from "../../scripts/policy-content.mjs";
import { createPolicyIngestionPlan, generatePolicyEmbeddings } from "../../scripts/ingest-policies.mjs";

const env = { NODE_ENV: "test" as const, AI_PROVIDER: "dashscope", DASHSCOPE_API_KEY: "fixture-only" };
const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
function completion(content: string | null, toolCalls?: any[]) {
  return { id: "chat-fixture", object: "chat.completion", created: 0, model: "qwen3.7-plus", choices: [{ index: 0, message: { role: "assistant", content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? "tool_calls" : "stop" }], usage };
}
beforeEach(() => { vi.stubEnv("AI_PROVIDER", "dashscope"); });
afterEach(() => { vi.unstubAllEnvs(); });

it("requires its own key, rejects stale GPT overrides, and shares the operations target", () => {
  expect(getConciergeProviderConfigurationError({ ...env, DASHSCOPE_API_KEY: "", OPENAI_API_KEY: "wrong-provider" })?.code).toBe("missing-dashscope-key");
  expect(getConciergeProviderConfigurationError({ ...env, AI_CONCIERGE_MODEL: "gpt-6-luna" })?.code).toBe("invalid-dashscope-model");
  expect(resolveOperationsProviderConfiguration(env)).toEqual({ provider: "dashscope", modelId: "qwen3.7-plus" });
  expect(getConciergeProviderConfigurationError({ ...env, DASHSCOPE_BASE_URL: "https://example.invalid/compatible-mode/v1" })?.code).toBe("invalid-dashscope-url");
});

it.each(["http://dashscope.aliyuncs.com/compatible-mode/v1", "https://user:secret@dashscope.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/compatible-mode/v1?key=secret", "https://dashscope.aliyuncs.com/api/v1", "https://dashscope.aliyuncs.com.evil.invalid/compatible-mode/v1"])("rejects credential redirection through %s", url => {
  expect(() => dashscopeBaseURL({ NODE_ENV: "test", DASHSCOPE_BASE_URL: url })).toThrow();
});

it("sends bounded non-thinking Chat requests without GPT-only settings", async () => {
  let body: any, endpoint: string;
  const fetch = vi.fn(async (url, init) => { endpoint = String(url); body = JSON.parse(String(init?.body)); expect(init?.redirect).toBe("error"); return Response.json(completion("完整回答。")); }) as unknown as typeof globalThis.fetch;
  const answer = await createConciergeAgent({ model: resolveConciergeModel(env, { fetch }) }).generate({ prompt: "你好" });
  expect(answer.text).toBe("完整回答。");
  expect(endpoint!).toBe(`${DEFAULT_DASHSCOPE_BASE_URL}/chat/completions`);
  expect(body).toMatchObject({ model: "qwen3.7-plus", enable_thinking: false, max_tokens: 4096, parallel_tool_calls: false });
  for (const key of ["reasoning_effort", "service_tier", "verbosity", "store"]) expect(body).not.toHaveProperty(key);
  expect(body.messages[0].role).toBe("system");
});

it("passes successful cabin tool results back before the final text", async () => {
  const source: ConciergeInventoryDataSource = {
    listCabins: vi.fn(async () => [{ id: 1, name: "001", maxCapacity: 2, regularPrice: 250, discount: 0, image: "https://example.invalid/cabin.jpg", description: "Quiet cabin" }]),
    getCabins: vi.fn(async () => []), getCabin: vi.fn(async () => null), getConflictingCabinIds: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ id: 1, minBookingLength: 3, maxBookingLength: 30, maxGuestsPerBooking: 10, breakfastPrice: 15 })),
  };
  const bodies: any[] = [];
  const fetch = vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(bodies.length === 1 ? completion(null, [{ id: "tool-fixture", type: "function", function: { name: "searchAvailableCabins", arguments: JSON.stringify({ startDate: "2027-01-10", endDate: "2027-01-13", numGuests: 2, maxTotalPrice: 1200, preferences: ["quiet"] }) } }]) : completion("001 三晚总价 $750，推荐安静的小屋。"));
  }) as unknown as typeof globalThis.fetch;
  const answer = await createConciergeAgent({ model: resolveConciergeModel(env, { fetch }), tools: createCabinTools(source) }).generate({ prompt: "请推荐小屋。" });
  expect(answer.text).toContain("$750"); expect(bodies).toHaveLength(2);
  expect(bodies[1].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "tool", tool_call_id: "tool-fixture", content: expect.stringContaining('"totalPrice":750') })]));
});

it("converts provider SSE into complete UI text", async () => {
  const chunk = (delta: object, finish: string | null = null) => ({ id: "stream-fixture", object: "chat.completion.chunk", created: 0, model: "qwen3.7-plus", choices: [{ index: 0, delta, finish_reason: finish }] });
  const events = [chunk({ role: "assistant", content: "流式" }), chunk({ content: "回答完整。" }), chunk({}, "stop"), { ...chunk({}), choices: [], usage }];
  const fetch = vi.fn(async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })) as unknown as typeof globalThis.fetch;
  const response = await createAgentUIStreamResponse({ agent: createConciergeAgent({ model: resolveConciergeModel(env, { fetch }) }), uiMessages: [{ id: "user", role: "user", parts: [{ type: "text", text: "请简短回答。" }] }] });
  const stream = await response.text();
  expect(stream).toContain('"type":"text-delta"'); expect(stream).toContain("回答完整。");
  expect(stream).toContain('"finishReason":"stop"'); expect(stream).not.toContain('"type":"error"');
});

it("requests and validates strict Briefing JSON", async () => {
  const insight = { summary: "Confirm safe preparation.", riskTags: ["food-allergy"], severity: "high", actionItems: ["Contact the kitchen."], confidence: 0.8 };
  let body: any;
  const fetch = vi.fn(async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json(completion(JSON.stringify(insight))); }) as unknown as typeof globalThis.fetch;
  const observer = createRunObserver({ surface: "booking-insight", promptVersion: "fixture", persist: async () => true });
  expect(await generateBookingInsight("Severe peanut allergy.", { env, model: resolveBookingInsightModel(env, { fetch }), observer })).toEqual(insight);
  expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true, schema: { additionalProperties: false } } });
  expect(body.max_tokens).toBe(2048); expect(body.enable_thinking).toBe(false);
});

it("uses DashScope query vectors and the corresponding database identity", async () => {
  const fetch = vi.fn(async (url, init) => {
    expect(String(url)).toBe(`${DEFAULT_DASHSCOPE_BASE_URL}/embeddings`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "text-embedding-v4", dimensions: 768, encoding_format: "float" });
    return Response.json({ data: [{ index: 0, embedding: Array(768).fill(0.01) }], usage: { total_tokens: 4 } });
  }) as unknown as typeof globalThis.fetch;
  expect(await embedPolicyQuery("宠物政策", { env, fetch })).toHaveLength(768);
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  await matchPolicyChunks({ client: { rpc }, queryText: "宠物政策", embedding: Array(768).fill(0.01) });
  expect(rpc).toHaveBeenCalledWith("match_policy_chunks_for_model", expect.objectContaining({ requested_embedding_model: "text-embedding-v4", requested_document_instruction_version: "dashscope-policy-document-v1" }));
});

it("splits 16 chunks into 10 and 6, preserving vector order and usage", async () => {
  const { config, documents } = await loadPolicyDocuments({ env });
  const plan = createPolicyIngestionPlan(documents, { documents: [], chunks: [] }, config);
  const sizes: number[] = [];
  const fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const offset = sizes.reduce((a, b) => a + b, 0); sizes.push(body.input.length);
    return Response.json({ data: body.input.map((_: string, index: number) => ({ index, embedding: Array(768).fill(offset + index + 1) })).reverse(), usage: { total_tokens: 100 } });
  }) as unknown as typeof globalThis.fetch;
  expect(await generatePolicyEmbeddings(plan, config, "fixture-only", { env, fetch })).toEqual({ inputTokens: 200 });
  expect(sizes).toEqual([10, 6]); expect(plan.documents.flatMap((document: any) => document.chunks).map((chunk: any) => chunk.embedding[0])).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
});

it.each([[400, "Arrearage", false], [403, "AllocationQuota.FreeTierOnly", false], [429, "BudgetLimitExceeded", false], [429, "insufficient_quota", true], [429, "Throttling.AllocationQuota", true]])("sanitizes %s/%s and distinguishes billing from TPM", async (status, code, retryable) => {
  const fetch = vi.fn(async () => Response.json({ error: { code, type: code, message: "private@example.invalid secret-value" } }, { status })) as unknown as typeof globalThis.fetch;
  const model = resolveConciergeModel(env, { fetch });
  if (typeof model === "string") throw new Error("Expected a concrete provider.");
  const failure = await Promise.resolve(model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "private guest input" }] }] })).catch(error => error);
  expect(failure.isRetryable).toBe(retryable); expect(JSON.stringify(failure)).not.toMatch(/private|secret-value/);
});

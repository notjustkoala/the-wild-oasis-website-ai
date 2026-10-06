import { createAgentUIStreamResponse } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createOperationsAgent } from "@/app/_ai/agents/operations-agent";
import * as embeddings from "@/app/_ai/providers/policy-embedding-model";
import { withRequiredPolicyLookup } from "@/app/_ai/providers/required-policy-lookup";

beforeEach(() => { vi.stubEnv("AI_PROVIDER", "dashscope"); vi.stubEnv("AI_POLICY_PROVIDER", "dashscope"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };

it("runs the actual caller-scoped policy tool before the only provider explanation", async () => {
  vi.spyOn(embeddings, "embedPolicyQuery").mockResolvedValue(Array(768).fill(0.01));
  const rpc = vi.fn(async (_name, args) => {
    const staff = args.query_text.includes("exception handling");
    return { data: [{ document_id: staff ? "exception-handling-sop" : "breakfast-dietary", title: "Governed policy", section: "Confirmation", version: 1, effective_date: "2026-08-30", content: "Confirm severe allergy preparation with the hotel team.", scope: staff ? "staff" : "public", semantic_similarity: 0.7, rrf_score: 0.03 }], error: null };
  });
  const from = vi.fn(() => { throw new Error("No booking access or write allowed."); });
  let providerCalls = 0;
  const model = new MockLanguageModelV4({ doStream: async options => {
    providerCalls += 1;
    expect(options.toolChoice).toEqual({ type: "none" });
    expect(options.tools ?? []).toHaveLength(0);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(options.prompt)).toContain("Confirm severe allergy preparation");
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({ type: "text-start", id: "answer" });
      controller.enqueue({ type: "text-delta", id: "answer", delta: "先联系酒店团队确认，再由管理员处理例外。" });
      controller.enqueue({ type: "text-end", id: "answer" });
      controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }); controller.close();
    } }) };
  } });
  const question = "严重过敏例外应该如何升级处理？请只解释流程，不要创建记录。";
  const response = await createAgentUIStreamResponse({ agent: createOperationsAgent({ client: { from, rpc }, actorId: "staff", model, currentPolicyQuestion: question }), uiMessages: [{ id: "user", role: "user", parts: [{ type: "text", text: question }] }] });
  const stream = await response.text();
  expect(providerCalls).toBe(1); expect(from).not.toHaveBeenCalled();
  expect(stream.indexOf('"type":"tool-output-available"')).toBeLessThan(stream.indexOf('"type":"text-delta"'));
  expect(stream).toContain("exception-handling-sop"); expect(stream).toContain('"finishReason":"stop"'); expect(stream).not.toContain('"type":"error"');
});

it("never intercepts a write tool or an unbound lookup", async () => {
  const doGenerate = vi.fn(async () => ({ content: [{ type: "text" as const, text: "Provider result" }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] }));
  const model = new MockLanguageModelV4({ doGenerate });
  const wrapped = withRequiredPolicyLookup(model, "pet policy");
  if (typeof wrapped === "string") throw new Error("Concrete model expected.");
  await wrapped.doGenerate({ prompt: [], toolChoice: { type: "tool", toolName: "addBookingInternalNote" }, tools: [{ type: "function", name: "addBookingInternalNote", inputSchema: {} }] });
  expect(doGenerate).toHaveBeenCalledOnce();
  expect(withRequiredPolicyLookup(model, undefined)).toBe(model);
});

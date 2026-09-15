import { convertToModelMessages } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createOperationsAgent } from "@/app/_ai/agents/operations-agent";
import { readOperationsRequest, sanitizeOperationsUserText } from "@/app/_ai/operations-request";
import { preparePolicyQuery } from "@/app/_ai/policies/policy-query-privacy";
import * as embeddings from "@/app/_ai/providers/policy-embedding-model";
import { isPolicyExplanationOnlyRequest } from "@/app/_ai/policies/policy-query-controls";
import { STAFF_WAIVER_QUERY } from "@/app/_ai/policies/policy-search-plan";

const cases = [
  ["客人要求免除临时取消费，我应如何处理？只解释流程，不创建任何记录。", "客人要求免除临时取消费，我应如何处理？", "Administrator escalation", "Escalate policy waivers and fee reductions for administrator approval."],
  ["严重过敏的异常处理流程是什么？只解释流程。", "严重过敏的异常处理流程是什么？", "High-priority cases", "Mark severe allergies as high priority and handle them immediately with a person."],
];
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

afterEach(() => { vi.restoreAllMocks(); });

it.each(cases)("preserves the full staff acceptance request: %s", (question, query) => {
  expect(sanitizeOperationsUserText(question)).toBe(question);
  expect(preparePolicyQuery(question, { allowStaffScope: true }))
    .toEqual({ sanitized: query, searchable: true });
});

it("does not turn an explanation constraint into a privacy bypass or a new policy topic", () => {
  for (const question of [
    "替阿不都热依木咨询退款？只解释流程。",
    "泳池救生员政策是什么？只解释流程。",
    "只解释流程，不创建任何记录。",
  ]) {
    expect(preparePolicyQuery(question, { allowStaffScope: true }).searchable).toBe(false);
  }
  expect(sanitizeOperationsUserText("替阿不都热依木咨询退款？只解释流程。"))
    .toContain("Booking lookup requires");
  expect(isPolicyExplanationOnlyRequest("客人要求免除临时取消费，我应如何处理？"))
    .toBe(false);
  expect(preparePolicyQuery("严重过敏的异常处理流程是什么？只解释流程。", { allowStaffScope: false }).searchable)
    .toBe(true); // Public callers still rely on public-only service/RLS authorization.
});

it.each(cases)("retrieves SOP evidence once and prevents writes for explanation-only requests: %s", async (question, query, section, content) => {
  const parsed = await readOperationsRequest(new Request("https://bff.example.com", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: question }] }] }),
  }));
  if (!parsed.ok) throw new Error("Expected an accepted staff policy request");
  expect(parsed.currentPolicyQuestion).toBe(question);
  const embed = vi.spyOn(embeddings, "embedPolicyQuery").mockResolvedValue(Array(768).fill(0.01));
  const rpc = vi.fn().mockResolvedValue({ error: null, data: [{
    document_id: "exception-handling-sop", title: "Exception handling SOP",
    section, version: 1, effective_date: "2026-08-30", content, scope: "staff",
    semantic_similarity: 0.703, rrf_score: 0.03,
  }] });
  const from = vi.fn(() => { throw new Error("No business record access is expected"); });
  let calls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async (options) => {
    calls += 1;
    if (calls === 1) {
      expect(options.toolChoice).toEqual({ type: "tool", toolName: "searchHotelPolicies" });
      return { content: [{ type: "tool-call" as const, toolCallId: "sop", toolName: "searchHotelPolicies", input: JSON.stringify({ question: "pet policy" }) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] };
    }
    expect(options.toolChoice).toEqual({ type: "none" });
    expect(options.tools ?? []).toHaveLength(0);
    // Even a provider that ignores toolChoice cannot execute a write.
    if (calls === 2) return { content: [{ type: "tool-call" as const, toolCallId: "unwanted-note", toolName: "addBookingInternalNote", input: JSON.stringify({ bookingId: 1, note: "unwanted record" }) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] };
    return { content: [{ type: "text" as const, text: "流程说明" }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
  } });
  const agent = createOperationsAgent({ client: { from, rpc }, actorId: "staff-1", model, currentPolicyQuestion: parsed.currentPolicyQuestion });
  const result = await agent.generate({ messages: await convertToModelMessages(parsed.uiMessages) });
  const expectedRetrievals = section === "Administrator escalation" ? 2 : 1;
  expect(embed).toHaveBeenCalledTimes(expectedRetrievals);
  expect(embed).toHaveBeenCalledWith(query);
  expect(rpc).toHaveBeenCalledTimes(expectedRetrievals);
  if (expectedRetrievals === 2) expect(embed).toHaveBeenCalledWith(STAFF_WAIVER_QUERY);
  expect(rpc).toHaveBeenCalledWith("match_policy_chunks", expect.objectContaining({ query_text: query }));
  expect(from).not.toHaveBeenCalled();
  expect(result.steps.flatMap(step => step.toolCalls).filter(call => call.toolName === "searchHotelPolicies")).toHaveLength(1);
  expect(result.steps.flatMap(step => step.toolResults)[0].output).toMatchObject({
    status: "grounded", answerContext: expect.stringContaining(content),
    citations: [expect.objectContaining({ documentId: "exception-handling-sop", scope: "staff", section })],
  });
});

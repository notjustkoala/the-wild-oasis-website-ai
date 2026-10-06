// @vitest-environment node
import { convertToModelMessages } from "ai";
import { readOperationsRequest } from "@/app/_ai/operations-request";
import { prepareOperationsTurn } from "@/app/_ai/operations-turn";
import type { CanonicalConciergeUIMessage } from "@/app/_ai/concierge-request";

async function turn(questions: string[]) {
  const parsed = await readOperationsRequest(new Request("https://bff.example.com/api/ai/admin", {
    method: "POST", body: JSON.stringify({ messages: questions.map((text, index) => ({ id: `user-${index}`, role: "user", parts: [{ type: "text", text }] })) }),
  }), new Date("2026-10-06T12:00:00Z"));
  if (!parsed.ok) throw new Error(parsed.message);
  return { parsed, messages: prepareOperationsTurn(parsed.uiMessages, { currentPolicyQuestion: parsed.currentPolicyQuestion, hasBoundInternalNote: Boolean(parsed.requestedInternalNoteDraft) }) };
}

it("answers only the SOP question after an earlier arrivals request", async () => {
  const { messages } = await turn(["查询明天到店的预订。", "严重过敏例外应该如何升级处理？请只解释流程，不要创建记录。"]);
  const model = await convertToModelMessages(messages);
  expect(model).toHaveLength(1);
  expect(JSON.stringify(model)).toContain("严重过敏");
  expect(JSON.stringify(model)).not.toContain("明天");
});

it.each(["查询明天到店的预订。", "查询 2026-08-31 到店的预订。", "查询 2026-08-31 至 2026-09-01 到店的预订。", "查询订单 699 的详情."]) ("does not repeat the old SOP answer when the new request is independent: %s", async (question) => {
  const { messages } = await turn(["严重过敏例外应该如何升级处理？请只解释流程，不要创建记录。", question]);
  expect(messages).toHaveLength(1);
  expect(JSON.stringify(await convertToModelMessages(messages))).not.toContain("严重过敏");
});

it("does not resurrect an older private internal-note command", async () => {
  const { parsed, messages } = await turn(["为预订 699 起草内部备注：Synthetic private text not for model", "查询订单 699 的详情。"]);
  expect(parsed.requestedInternalNoteDraft).toBeUndefined();
  expect(JSON.stringify(messages)).not.toMatch(/Synthetic private|起草/);
});

it("keeps context-dependent follow-ups in one labelled user turn, never system data", async () => {
  const messages = Array.from({ length: 10 }, (_, index): CanonicalConciergeUIMessage => ({ id: String(index), role: "user", parts: [{ type: "text", text: index === 9 ? "What dates did I just ask about?" : `Earlier question ${index}` }] }));
  const prepared = prepareOperationsTurn(messages);
  const model = await convertToModelMessages(prepared);
  expect(model).toHaveLength(1);
  expect(model[0].role).toBe("user");
  expect(JSON.stringify(model)).toContain("closed turns");
  expect(JSON.stringify(model)).toContain("the only request to answer");
  expect(JSON.stringify(model)).not.toContain("Earlier question 0");
  expect(JSON.stringify(model)).toContain("Earlier question 8");
});

import { readOperationsRequest, sanitizeOperationsUserText } from "@/app/_ai/operations-request";
import { createPolicySearchService } from "@/app/_ai/tools/policy-search";

it.each([
  "需要提前72小时申请无障碍支持吗？",
  "需要提前 72 小时申请无障碍支持吗？",
  "需要提前48小时申请无障碍支持吗？",
])("keeps a policy duration through the staff boundary and embedding: %s", async (question) => {
  expect(sanitizeOperationsUserText(question)).toBe(question);
  const parsed = await readOperationsRequest(new Request("https://bff.example.com", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: question }] }] }),
  }));
  if (!parsed.ok) throw new Error("Expected accepted accessibility question");
  expect(parsed.currentPolicyQuestion).toBe(question);
  const embedQuery = vi.fn(async (_query: string) => Array(768).fill(0.01));
  const search = vi.fn(async () => [{
    citation: { documentId: "accessibility", title: "Accessibility requests", section: "Requesting support", version: 1,
      effectiveDate: "2026-08-30", scope: "public" as const,
      excerpt: "Guests should disclose accessibility needs as early as possible, preferably at least 72 hours before check-in." },
    semanticSimilarity: 0.8, rrfScore: 0.03,
  }]);
  const service = createPolicySearchService({ client: { rpc: vi.fn() }, allowedScopes: ["public", "staff"], embedQuery, search });
  const result = await service({ question: parsed.currentPolicyQuestion! });
  expect(embedQuery).toHaveBeenCalledTimes(1);
  expect(embedQuery).toHaveBeenCalledWith(question);
  expect(result).toMatchObject({ status: "grounded", answerContext: expect.stringContaining("preferably at least 72 hours"),
    citations: [expect.objectContaining({ documentId: "accessibility", section: "Requesting support" })] });
});

it.each([
  "需要提前123456小时申请无障碍支持吗？",
  "需要提前72申请无障碍支持吗？",
  "需要提前72小时申请无障碍支持吗？私密姓名阿不都热依木",
])("does not accept an unbounded number, bare identifier or unknown identity: %s", (question) => {
  expect(sanitizeOperationsUserText(question)).toContain("Booking lookup requires");
});

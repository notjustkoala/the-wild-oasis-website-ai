// @vitest-environment node
import { convertToModelMessages } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createOperationsAgent } from "@/app/_ai/agents/operations-agent";
import { readOperationsRequest, sanitizeOperationsUserText } from "@/app/_ai/operations-request";
import * as embeddings from "@/app/_ai/providers/policy-embedding-model";

afterEach(() => { vi.restoreAllMocks(); });

it.each([
  "客人阿不都热依木想知道宠物政策",
  "客人王小明想知道宠物政策和未知内部暗号",
])("still blocks unrecognized identity or subject text: %s", (question) => {
  expect(sanitizeOperationsUserText(question))
    .toBe("Booking lookup requires a numeric bookingId; guest names are not sent to the AI.");
});

it.each(["王小明", "李明", "欧阳晓月"])("removes %s before both generation and the serialized embedding request", async (name) => {
  const question = `客人${name}想知道宠物政策`;
  const safeQuestion = "客人[redacted]想知道宠物政策";
  const parsed = await readOperationsRequest(new Request("https://bff.example.com", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: question }] }] }),
  }));
  if (!parsed.ok) throw new Error("Expected accepted policy question");
  expect(parsed.currentPolicyQuestion).toBe(safeQuestion);
  expect(JSON.stringify(parsed.uiMessages)).not.toContain(name);

  // Run the real embedding adapter and Google SDK serializer. Only the HTTP
  // transport is intercepted, so no name, request or key leaves this test.
  const requestBodies: unknown[] = [];
  const embeddingFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return Response.json({ embedding: { values: Array(768).fill(0.01) } });
  });
  const originalEmbed = embeddings.embedPolicyQuery;
  vi.spyOn(embeddings, "embedPolicyQuery").mockImplementation(query => originalEmbed(query, {
    env: { NODE_ENV: "test", GOOGLE_GENERATIVE_AI_API_KEY: "test-only-key" },
    fetch: embeddingFetch as typeof fetch,
  }));
  const rpc = vi.fn().mockResolvedValue({ error: null, data: [{
    document_id: "pet-policy", title: "Pet policy", section: "Eligible pets and limits",
    version: 1, effective_date: "2026-08-30", content: "One cat or dog up to 20 kg.",
    scope: "public", semantic_similarity: 0.8, rrf_score: 0.03,
  }] });
  const from = vi.fn(() => { throw new Error("No booking lookup is needed"); });
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
  let modelCalls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    modelCalls += 1;
    return modelCalls === 1
      ? { content: [{ type: "tool-call" as const, toolCallId: "pet", toolName: "searchHotelPolicies", input: JSON.stringify({ question: "pet policy" }) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] }
      : { content: [{ type: "text" as const, text: "可携带一只不超过 20kg 的猫或狗。" }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
  } });
  const agent = createOperationsAgent({ client: { from, rpc }, actorId: "staff-1", model, currentPolicyQuestion: parsed.currentPolicyQuestion });
  const result = await agent.generate({ messages: await convertToModelMessages(parsed.uiMessages) });

  expect(embeddingFetch).toHaveBeenCalledTimes(1);
  expect(requestBodies).toEqual([expect.objectContaining({
    content: { parts: [{ text: safeQuestion }] },
    outputDimensionality: 768, taskType: "RETRIEVAL_QUERY",
  })]);
  expect(JSON.stringify(requestBodies)).not.toContain(name);
  expect(JSON.stringify(model.doGenerateCalls.map(call => call.prompt))).not.toContain(name);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("match_policy_chunks", expect.objectContaining({ query_text: safeQuestion }));
  expect(from).not.toHaveBeenCalled();
  expect(result.steps.flatMap(step => step.toolResults)[0].output).toMatchObject({ status: "grounded", citations: [expect.objectContaining({ documentId: "pet-policy" })] });
});

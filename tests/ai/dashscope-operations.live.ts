import { readFile } from "node:fs/promises";
import { createAgentUIStreamResponse } from "ai";
import { createOperationsAgent } from "@/app/_ai/agents/operations-agent";
import { resolveConciergeModel } from "@/app/_ai/providers/concierge-model";
import { createRunObserver } from "@/app/_ai/observability/run";

it("checks the real DashScope forced policy tool and post-tool stream with synthetic RLS evidence", async () => {
  const corpus = JSON.parse(await readFile("output/dashscope-policy-migration/prepared-corpus.json", "utf8"));
  const timings: Array<Record<string, unknown>> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)); const start = Date.now();
    console.log(JSON.stringify({ event: "request-start", tools: body.tools?.map((tool: any) => tool.function.name), toolChoice: body.tool_choice, thinking: body.enable_thinking, maxTokens: body.max_tokens, bytes: Buffer.byteLength(String(init?.body), "utf8") }));
    const response = await globalThis.fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(35_000)]) });
    timings.push({ status: response.status, headersMs: Date.now() - start });
    return response;
  };
  const client = {
    from: () => { throw new Error("No business writes/reads allowed in this model contract test."); },
    rpc: async (_name: string, args: any) => {
      const id = args.query_text.includes("exception handling") ? "exception-handling-sop" : "breakfast-dietary";
      const document = corpus.payloads.find((item: any) => item.document_payload.document_id === id);
      return { data: document.chunk_payloads.map((chunk: any) => ({ document_id: id, title: document.document_payload.title, section: chunk.section, version: 1, effective_date: "2026-08-30", content: chunk.content, scope: document.document_payload.scope, semantic_similarity: 0.7, rrf_score: 0.03 })), error: null };
    },
  };
  const observer = createRunObserver({ surface: "operations", model: "qwen3.7-plus", promptVersion: "live-contract", persist: async () => true });
  const question = "严重过敏例外应该如何升级处理？请只解释流程，不要创建记录。";
  const response = await createAgentUIStreamResponse({ agent: createOperationsAgent({ client, actorId: "synthetic", model: resolveConciergeModel(process.env, { fetch }), currentPolicyQuestion: question, observer }), uiMessages: [{ id: "user", role: "user", parts: [{ type: "text", text: question }] }], onError: () => "Sanitized model contract failure." });
  const result = await response.text();
  console.log(JSON.stringify({ event: "request-result", timings, textDeltas: (result.match(/text-delta/g) || []).length, toolOutputs: (result.match(/tool-output-available/g) || []).length, hasError: result.includes('"type":"error"') }));
  expect(result).not.toContain('"type":"error"'); expect(result).toContain('"type":"text-delta"'); expect(result).toContain("searchHotelPolicies");
});

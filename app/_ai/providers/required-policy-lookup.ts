import "server-only";
import { randomUUID } from "node:crypto";
import { wrapLanguageModel, type LanguageModel } from "ai";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";

// The server already mandates and binds this read-only lookup. Schedule the
// actual SDK tool execution directly, without asking the model to repeat that
// decision. The tool still validates/sanitizes input and uses its caller's RLS
// client. Only the later explanation invokes the provider; no facts are invented.
export function withRequiredPolicyLookup(model: LanguageModel, question: string | undefined) {
  if (!question || typeof model === "string") return model;
  let scheduled = false;
  const required = (params: LanguageModelV4CallOptions) => !scheduled
    && params.toolChoice?.type === "tool" && params.toolChoice.toolName === "searchHotelPolicies"
    && params.tools?.some(tool => tool.type === "function" && tool.name === "searchHotelPolicies");
  const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
  const finishReason = { unified: "tool-calls" as const, raw: undefined };
  function call(params: LanguageModelV4CallOptions) {
    params.abortSignal?.throwIfAborted();
    scheduled = true;
    return { type: "tool-call" as const, toolCallId: `server-policy-${randomUUID()}`, toolName: "searchHotelPolicies", input: JSON.stringify({ question }) };
  }
  return wrapLanguageModel({ model, middleware: {
    wrapGenerate: async ({ params, doGenerate }) => required(params)
      ? { content: [call(params)], finishReason, usage, warnings: [] }
      : doGenerate(),
    wrapStream: async ({ params, doStream }) => {
      if (!required(params)) return doStream();
      const lookup = call(params);
      return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue(lookup);
        controller.enqueue({ type: "finish", finishReason, usage });
        controller.close();
      } }) };
    },
  } });
}

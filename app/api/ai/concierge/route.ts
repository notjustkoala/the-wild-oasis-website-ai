import { createAgentUIStreamResponse, createUIMessageStream, createUIMessageStreamResponse } from "ai";

import { createConciergeAgent, CONCIERGE_INSTRUCTIONS } from "@/app/_ai/agents/concierge-agent";
import { observedRoute } from "@/app/_ai/observability/route";
import {
  readBoundedConciergeJson,
  prepareConciergeTurn,
  validateConciergeRequestBody,
} from "@/app/_ai/concierge-request";
import {
  conciergeStreamErrorMessage,
  CONCIERGE_TIMEOUT,
  createConciergeAbortRecoveryTransform,
} from "@/app/_ai/concierge-stream";
import { getConciergeProviderConfigurationError } from "@/app/_ai/providers/concierge-model";
import { ConciergeDailyQuotaError } from "@/app/_ai/providers/concierge-quota";
import { CONCIERGE_DAILY_QUOTA_MESSAGE } from "@/app/_ai/concierge-error-messages";
import { OpenAIAccountQuotaError } from "@/app/_ai/providers/openai-model";
import { conciergeYearClarification } from "@/app/_ai/concierge-memory";

export const dynamic = "force-dynamic";
export const maxDuration = 100;

export async function POST(request: Request) {
  const observation = observedRoute("concierge", CONCIERGE_INSTRUCTIONS);
  const { run, fail, headers } = observation;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origin is not allowed.", 403, "unauthorized", "denied");
  const parsed = await readBoundedConciergeJson(request);
  if (!parsed.ok) {
    return fail(parsed.message, parsed.status, "invalid-request", "denied");
  }

  const validated = validateConciergeRequestBody(parsed.body);
  if (!validated.ok) {
    return fail(validated.message, 400, "invalid-request", "denied");
  }

  if (getConciergeProviderConfigurationError()) {
    return fail("The AI concierge is not configured yet. Please browse cabins or try again later.", 503, "configuration");
  }
  const limited = await observation.limit();
  if (limited) return limited;
  run.watch(request.signal);
  try {
    const turn = prepareConciergeTurn(validated.uiMessages);
    const userText = validated.uiMessages.at(-1)?.parts.filter(part => part.type === "text").map(part => part.text).join("\n") ?? "";
    const clarification = !turn.preferenceRecallOnly && conciergeYearClarification(turn.demandMemory, userText);
    if (clarification) {
      // A deterministic missing-field question requires no model/inventory call.
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          if (request.signal.aborted) { writer.write({ type: "abort" }); await run.finish("cancelled", "cancelled"); return; }
          writer.write({ type: "start" });
          writer.write({ type: "text-start", id: "stay-year" });
          run.firstText();
          writer.write({ type: "text-delta", id: "stay-year", delta: clarification });
          writer.write({ type: "text-end", id: "stay-year" });
          run.step({ usage: { inputTokens: 0, outputTokens: 0, inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { reasoningTokens: 0 } } });
          await run.finish();
          writer.write({ type: "finish", finishReason: "stop", messageMetadata: { finishReason: "stop" } });
        },
        onError: error => conciergeStreamErrorMessage(error, run.traceId),
      });
      return createUIMessageStreamResponse({ stream, headers: Object.fromEntries(headers) });
    }
    const agent = createConciergeAgent({
      currentPolicyQuestion: turn.currentPolicyQuestion,
      preferenceRecallOnly: turn.preferenceRecallOnly,
      demandMemory: turn.demandMemory,
      searchDemandNow: turn.searchDemandNow,
      observer: run,
    });
    return await createAgentUIStreamResponse({
      agent,
      uiMessages: turn.uiMessages,
      abortSignal: request.signal,
      timeout: CONCIERGE_TIMEOUT,
      experimental_transform: [run.transform(request.signal), createConciergeAbortRecoveryTransform(request.signal)],
      onError: (error) => conciergeStreamErrorMessage(error, run.traceId),
      messageMetadata: ({ part }) => part.type === "finish" ? { finishReason: part.finishReason } : undefined,
      headers: Object.fromEntries(headers), // Includes Cache-Control: no-store.
    });
  } catch (error) {
    if (error instanceof OpenAIAccountQuotaError) return fail(error.message, 429, "provider-unavailable");
    if (error instanceof ConciergeDailyQuotaError) return fail(CONCIERGE_DAILY_QUOTA_MESSAGE, 429, "provider-unavailable");
    const timeout = error instanceof Error && /timeout|abort/i.test(error.name);
    return fail("The concierge is temporarily unavailable. Please browse cabins or try again.", timeout ? 504 : 503, request.signal?.aborted ? "cancelled" : timeout ? "timeout" : "provider-unavailable", request.signal?.aborted ? "cancelled" : timeout ? "timeout" : "failed");
  }
}

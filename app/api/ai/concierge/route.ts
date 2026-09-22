import { createAgentUIStreamResponse } from "ai";

import { createConciergeAgent, CONCIERGE_INSTRUCTIONS } from "@/app/_ai/agents/concierge-agent";
import { observedRoute } from "@/app/_ai/observability/route";
import {
  readBoundedConciergeJson,
  scopeConciergePolicyTurn,
  validateConciergeRequestBody,
} from "@/app/_ai/concierge-request";
import {
  CONCIERGE_RECOVERABLE_ERROR,
  CONCIERGE_TIMEOUT,
  createConciergeAbortRecoveryTransform,
} from "@/app/_ai/concierge-stream";
import { getConciergeProviderConfigurationError } from "@/app/_ai/providers/concierge-model";

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
    const turn = scopeConciergePolicyTurn(validated.uiMessages);
    const agent = createConciergeAgent({
      currentPolicyQuestion: turn.currentPolicyQuestion,
      observer: run,
    });
    return await createAgentUIStreamResponse({
      agent,
      uiMessages: turn.uiMessages,
      abortSignal: request.signal,
      timeout: CONCIERGE_TIMEOUT,
      experimental_transform: [run.transform(request.signal), createConciergeAbortRecoveryTransform(request.signal)],
      onError: () =>
        `${CONCIERGE_RECOVERABLE_ERROR} Reference: ${run.traceId}`,
      headers: Object.fromEntries(headers), // Includes Cache-Control: no-store.
    });
  } catch (error) {
    const timeout = error instanceof Error && /timeout|abort/i.test(error.name);
    return fail("The concierge is temporarily unavailable. Please browse cabins or try again.", timeout ? 504 : 503, request.signal?.aborted ? "cancelled" : timeout ? "timeout" : "provider-unavailable", request.signal?.aborted ? "cancelled" : timeout ? "timeout" : "failed");
  }
}

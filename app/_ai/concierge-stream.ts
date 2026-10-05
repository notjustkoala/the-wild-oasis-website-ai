import type { StreamTextTransform, ToolSet } from "ai";
import { safeGenerationErrorDiagnostic } from "@/app/_ai/observability/error-diagnostic";
import { ConciergeInputError, CONCIERGE_INPUT_NOTICE_PREFIX } from "@/app/_ai/tools/input-error";
import { ConciergeDailyQuotaError } from "@/app/_ai/providers/concierge-quota";
import { CONCIERGE_DAILY_QUOTA_MESSAGE, CONCIERGE_RATE_LIMIT_MESSAGE } from "@/app/_ai/concierge-error-messages";

export const CONCIERGE_TIMEOUT = {
  totalMs: 90_000,
  stepMs: 60_000,
  firstChunkMs: 60_000,
  chunkMs: 30_000,
  toolMs: 20_000,
} as const;

// Non-streaming generation supports total, per-step, and tool deadlines, but
// not streaming-only first-chunk or inter-chunk deadlines.
export const CONCIERGE_GENERATE_TIMEOUT = {
  totalMs: CONCIERGE_TIMEOUT.totalMs,
  // Leave headroom below both the total deadline and the 100-second route
  // duration while allowing a retried non-streaming provider step to exceed
  // the stream's first-chunk budget.
  stepMs: 80_000,
  toolMs: CONCIERGE_TIMEOUT.toolMs,
} as const;

export const CONCIERGE_RECOVERABLE_ERROR =
  "The concierge took too long to respond. Please retry your request.";

export function conciergeStreamErrorMessage(error: unknown, traceId: string): string {
  if (error instanceof ConciergeInputError) {
    return `${CONCIERGE_INPUT_NOTICE_PREFIX}${error.message}`;
  }
  if (error instanceof ConciergeDailyQuotaError) return `${CONCIERGE_DAILY_QUOTA_MESSAGE} Reference: ${traceId}`;
  const diagnostic = safeGenerationErrorDiagnostic(error);
  const message = diagnostic.code === "provider-rate-limit"
    ? CONCIERGE_RATE_LIMIT_MESSAGE
    : diagnostic.code === "timeout"
    ? CONCIERGE_RECOVERABLE_ERROR
    : "The concierge could not load the requested data. Please try again.";
  return `${message} Reference: ${traceId}`;
}

export function createConciergeAbortRecoveryTransform<TOOLS extends ToolSet>(
  requestSignal: AbortSignal
): StreamTextTransform<TOOLS> {
  return () =>
    new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === "abort" && !requestSignal.aborted) {
          controller.enqueue({
            type: "error",
            error: Object.assign(new Error(CONCIERGE_RECOVERABLE_ERROR), { name: "TimeoutError" }),
          });
          return;
        }
        controller.enqueue(chunk);
      },
    });
}

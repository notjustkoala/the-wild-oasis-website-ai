import type { StreamTextTransform, ToolSet } from "ai";

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

export function createConciergeAbortRecoveryTransform<TOOLS extends ToolSet>(
  requestSignal: AbortSignal
): StreamTextTransform<TOOLS> {
  return () =>
    new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === "abort" && !requestSignal.aborted) {
          controller.enqueue({
            type: "error",
            error: new Error(CONCIERGE_RECOVERABLE_ERROR),
          });
          return;
        }
        controller.enqueue(chunk);
      },
    });
}

import "server-only";

import {
  BookingInsightGenerationError,
  generateBookingInsight,
  type BookingInsightFailureCode,
} from "@/app/_ai/booking-insight-generator";
import {
  normalizeObservation,
  prepareObservationForModel,
} from "@/app/_ai/booking-insight-privacy";
import type { BookingInsightRepository } from "@/app/_ai/booking-insight-repository";
import {
  bookingInsightIdentityMatches,
  createCurrentBookingInsightIdentity,
} from "@/app/_ai/booking-insight-identity";
import type { BookingInsight } from "@/app/_ai/schemas/booking-insight";
import {
  BookingNotFoundError,
  type BookingInsightView,
  viewForBookingInsight,
} from "@/app/_ai/booking-insight-view";

type AnalyzeDependencies = {
  env?: NodeJS.ProcessEnv;
  promptVersion?: string;
  generate?: (redactedObservation: string) => Promise<BookingInsight>;
  traceId?: string;
  signal?: AbortSignal;
  onGeneration?: () => void;
};

function failureCode(error: unknown): BookingInsightFailureCode {
  return error instanceof BookingInsightGenerationError
    ? error.code
    : "provider-unavailable";
}

export async function analyzeBookingInsight(
  repository: BookingInsightRepository,
  bookingId: number,
  options: { force: boolean },
  dependencies: AnalyzeDependencies = {}
): Promise<BookingInsightView> {
  const observation = await repository.getBookingObservation(bookingId);
  if (observation === undefined) throw new BookingNotFoundError("Booking not found.");

  const normalized = normalizeObservation(observation ?? "");
  if (!normalized) return { state: "empty", insight: null };
  const safeObservation = prepareObservationForModel(normalized);
  if (!safeObservation.ok) {
    return { state: "manual-review", insight: null };
  }

  const env = dependencies.env ?? process.env;
  const identity = createCurrentBookingInsightIdentity(
    normalized,
    env,
    dependencies.promptVersion
  );
  const claimed = await repository.claim({
    bookingId,
    sourceHash: identity.sourceHash,
    model: identity.model,
    promptVersion: identity.promptVersion,
    force: options.force,
  });

  if (claimed.claim_state !== "claimed") {
    if (!bookingInsightIdentityMatches(claimed, identity)) {
      return { state: "stale", insight: claimed };
    }
    return viewForBookingInsight(claimed);
  }
  if (!claimed.generation_token) {
    throw new Error("Insight generation token is missing.");
  }

  try {
    dependencies.onGeneration?.();
    // This is the only value allowed to cross the model-provider boundary.
    const result = await (dependencies.generate ?? ((value) =>
      generateBookingInsight(value, { env, traceId: dependencies.traceId, signal: dependencies.signal })))(safeObservation.value);
    const completed = await repository.complete({
      bookingId,
      generationToken: claimed.generation_token,
      result,
    });
    return viewForBookingInsight(completed ?? claimed);
  } catch (error) {
    const failed = await repository.fail({
      bookingId,
      generationToken: claimed.generation_token,
      failureCode: failureCode(error),
    });
    return viewForBookingInsight(failed ?? { ...claimed, status: "failed" });
  }
}

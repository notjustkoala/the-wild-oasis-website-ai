import "server-only";

import type { BookingInsightRecord, BookingInsightRepository } from "@/app/_ai/booking-insight-repository";
import type { BookingInsightFeedback } from "@/app/_ai/schemas/booking-insight";
import {
  normalizeObservation,
  prepareObservationForModel,
} from "@/app/_ai/booking-insight-privacy";
import {
  bookingInsightIdentityMatches,
  createCurrentBookingInsightIdentity,
} from "@/app/_ai/booking-insight-identity";

export type BookingInsightViewState =
  | "missing"
  | "empty"
  | "manual-review"
  | "stale"
  | "pending"
  | "cached"
  | "failed"
  | "reviewed";

export type BookingInsightView = {
  state: BookingInsightViewState;
  insight: BookingInsightRecord | null;
};

export class BookingNotFoundError extends Error {}
export class BookingInsightNotReviewableError extends Error {}
export class BookingInsightStaleError extends Error {}

export function viewForBookingInsight(
  record: BookingInsightRecord | null
): BookingInsightView {
  if (!record) return { state: "missing", insight: null };
  if (record.status === "pending") return { state: "pending", insight: record };
  if (record.status === "failed") return { state: "failed", insight: record };
  return { state: record.reviewed_at ? "reviewed" : "cached", insight: record };
}

async function requireObservation(
  repository: BookingInsightRepository,
  bookingId: number
): Promise<string> {
  const observation = await repository.getBookingObservation(bookingId);
  if (observation === undefined) throw new BookingNotFoundError("Booking not found.");
  return normalizeObservation(observation ?? "");
}

export async function getBookingInsightView(
  repository: BookingInsightRepository,
  bookingId: number,
  dependencies: { env?: NodeJS.ProcessEnv; promptVersion?: string } = {}
): Promise<BookingInsightView> {
  const observation = await requireObservation(repository, bookingId);
  if (!observation) return { state: "empty", insight: null };
  if (!prepareObservationForModel(observation).ok) {
    return { state: "manual-review", insight: null };
  }
  const record = await repository.getInsight(bookingId);
  if (!record) return { state: "missing", insight: null };
  const identity = createCurrentBookingInsightIdentity(
    observation,
    dependencies.env,
    dependencies.promptVersion
  );
  if (!bookingInsightIdentityMatches(record, identity)) {
    return { state: "stale", insight: record };
  }
  return viewForBookingInsight(record);
}

export async function reviewBookingInsight(
  repository: BookingInsightRepository,
  bookingId: number,
  feedback: BookingInsightFeedback,
  dependencies: { env?: NodeJS.ProcessEnv; promptVersion?: string } = {}
): Promise<BookingInsightView> {
  const observation = await requireObservation(repository, bookingId);
  const existing = await repository.getInsight(bookingId);
  if (!existing || existing.status !== "succeeded") {
    throw new BookingInsightNotReviewableError(
      "Only a completed insight can be reviewed."
    );
  }
  const identity = createCurrentBookingInsightIdentity(
    observation,
    dependencies.env,
    dependencies.promptVersion
  );
  if (!bookingInsightIdentityMatches(existing, identity)) {
    throw new BookingInsightStaleError(
      "The observation changed; refresh and regenerate the insight before reviewing it."
    );
  }
  return viewForBookingInsight(await repository.saveFeedback(bookingId, feedback));
}

import "server-only";

import { BOOKING_INSIGHT_PROMPT_VERSION } from "@/app/_ai/booking-insight-generator";
import { createBookingInsightSourceHash } from "@/app/_ai/booking-insight-privacy";
import { resolveBookingInsightModelIdentity } from "@/app/_ai/providers/booking-insight-model";

export type BookingInsightIdentity = {
  model: string;
  promptVersion: string;
  sourceHash: string;
};

export function createCurrentBookingInsightIdentity(
  observation: string,
  env: NodeJS.ProcessEnv = process.env,
  promptVersion = BOOKING_INSIGHT_PROMPT_VERSION
): BookingInsightIdentity {
  let model = "unconfigured";
  try {
    model = resolveBookingInsightModelIdentity(env).modelId;
  } catch {
    // A stable non-secret marker makes an earlier configured result stale and
    // lets the subsequent generation attempt persist a safe config failure.
  }
  return {
    model,
    promptVersion,
    sourceHash: createBookingInsightSourceHash({
      observation,
      model,
      promptVersion,
    }),
  };
}

export function bookingInsightIdentityMatches(
  record: { model: string; prompt_version: string; source_hash: string },
  identity: BookingInsightIdentity
) {
  return (
    record.model === identity.model &&
    record.prompt_version === identity.promptVersion &&
    record.source_hash === identity.sourceHash
  );
}

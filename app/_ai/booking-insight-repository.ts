import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BookingInsight,
  BookingInsightFeedback,
} from "@/app/_ai/schemas/booking-insight";

export type BookingInsightStatus = "pending" | "succeeded" | "failed";

export type BookingInsightRecord = {
  booking_id: number;
  result: BookingInsight | null;
  model: string;
  prompt_version: string;
  source_hash: string;
  status: BookingInsightStatus;
  generation_token: string | null;
  attempt_count: number;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewer_feedback: BookingInsightFeedback | null;
};

export type ClaimResult = BookingInsightRecord & {
  claim_state: "claimed" | "cached" | "pending" | "failed";
};

export interface BookingInsightRepository {
  getBookingObservation(bookingId: number): Promise<string | null | undefined>;
  getInsight(bookingId: number): Promise<BookingInsightRecord | null>;
  claim(input: {
    bookingId: number;
    sourceHash: string;
    model: string;
    promptVersion: string;
    force: boolean;
  }): Promise<ClaimResult>;
  complete(input: {
    bookingId: number;
    generationToken: string;
    result: BookingInsight;
  }): Promise<BookingInsightRecord | null>;
  fail(input: {
    bookingId: number;
    generationToken: string;
    failureCode: string;
  }): Promise<BookingInsightRecord | null>;
  saveFeedback(
    bookingId: number,
    feedback: BookingInsightFeedback
  ): Promise<BookingInsightRecord>;
}

function throwDataError(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export function createBookingInsightRepository(
  client: SupabaseClient
): BookingInsightRepository {
  return {
    async getBookingObservation(bookingId) {
      const { data, error } = await client
        .from("bookings")
        .select("observations")
        .eq("id", bookingId)
        .maybeSingle();
      if (error) throwDataError(error, "Booking lookup failed.");
      return data ? (data.observations as string) : undefined;
    },

    async getInsight(bookingId) {
      const { data, error } = await client
        .from("booking_ai_insights")
        .select("*")
        .eq("booking_id", bookingId)
        .maybeSingle();
      if (error) throwDataError(error, "Insight lookup failed.");
      return (data as BookingInsightRecord | null) ?? null;
    },

    async claim(input) {
      const { data, error } = await client.rpc("claim_booking_ai_insight", {
        p_booking_id: input.bookingId,
        p_source_hash: input.sourceHash,
        p_model: input.model,
        p_prompt_version: input.promptVersion,
        p_force: input.force,
      });
      if (error) throwDataError(error, "Insight claim failed.");
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("Insight claim returned no state.");
      return row as ClaimResult;
    },

    async complete(input) {
      const { data, error } = await client.rpc("complete_booking_ai_insight", {
        p_booking_id: input.bookingId,
        p_generation_token: input.generationToken,
        p_result: input.result,
      });
      if (error) throwDataError(error, "Insight completion failed.");
      const row = Array.isArray(data) ? data[0] : data;
      return (row as BookingInsightRecord | undefined) ?? null;
    },

    async fail(input) {
      const { data, error } = await client.rpc("fail_booking_ai_insight", {
        p_booking_id: input.bookingId,
        p_generation_token: input.generationToken,
        p_failure_code: input.failureCode,
      });
      if (error) throwDataError(error, "Insight failure state could not be saved.");
      const row = Array.isArray(data) ? data[0] : data;
      return (row as BookingInsightRecord | undefined) ?? null;
    },

    async saveFeedback(bookingId, feedback) {
      const { data, error } = await client
        .from("booking_ai_insights")
        .update({
          reviewer_feedback: feedback,
          reviewed_at: new Date().toISOString(),
        })
        .eq("booking_id", bookingId)
        .eq("status", "succeeded")
        .select("*")
        .single();
      if (error) throwDataError(error, "Feedback could not be saved.");
      return data as BookingInsightRecord;
    },
  };
}

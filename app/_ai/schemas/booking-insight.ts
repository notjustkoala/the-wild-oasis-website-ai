import { z } from "zod";

export const bookingRiskTagSchema = z.enum([
  "food-allergy",
  "late-arrival",
  "pet",
  "celebration",
  "extra-bed",
  "other",
]);

export const bookingInsightSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    riskTags: z.array(bookingRiskTagSchema).max(6),
    severity: z.enum(["low", "medium", "high"]),
    actionItems: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const bookingInsightFeedbackSchema = z
  .object({
    verdict: z.enum(["correct", "partially-correct", "incorrect"]),
    correctedTags: z.array(bookingRiskTagSchema).max(6).optional(),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict();

export const bookingInsightPostBodySchema = z
  .object({ force: z.boolean().optional().default(false) })
  .strict();

export type BookingInsight = z.infer<typeof bookingInsightSchema>;
export type BookingInsightFeedback = z.infer<
  typeof bookingInsightFeedbackSchema
>;
export type BookingRiskTag = z.infer<typeof bookingRiskTagSchema>;

import { z } from "zod";

const positiveInteger = z.preprocess((value) => {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return Number(value);
  }
  return value;
}, z.number().int().positive());

export const bookingInputSchema = z
  .object({
    cabinId: positiveInteger,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    numGuests: positiveInteger,
    observations: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .nullable()
      .transform((value) => value ?? ""),
  })
  .strict();

export const bookingUpdateInputSchema = z
  .object({
    bookingId: positiveInteger,
    numGuests: positiveInteger,
    observations: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .nullable()
      .transform((value) => value ?? ""),
  })
  .strict();

export type BookingInput = z.infer<typeof bookingInputSchema>;
export type BookingUpdateInput = z.infer<typeof bookingUpdateInputSchema>;

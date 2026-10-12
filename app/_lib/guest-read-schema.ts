import { z } from "zod";
import { localDateFromDateOnly } from "./reservation-draft";

export const guestSessionSchema = z.object({
  user: z.object({ name: z.string().nullable(), image: z.string().nullable() }).nullable(),
});
export type GuestUser = z.infer<typeof guestSessionSchema>["user"];

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { localDateFromDateOnly(value); return true; } catch { return false; }
});
export const reservationAvailabilitySchema = z.object({
  cabin: z.object({
    id: z.number().int().positive(),
    maxCapacity: z.number().int().positive(),
    regularPrice: z.number().nonnegative(),
    discount: z.number().nonnegative(),
  }).refine(value => value.discount <= value.regularPrice),
  settings: z.object({
    minBookingLength: z.number().int().positive(),
    maxBookingLength: z.number().int().positive(),
    maxGuestsPerBooking: z.number().int().positive(),
  }).refine(value => value.maxBookingLength >= value.minBookingLength),
  bookedDates: z.array(dateOnly),
});
export type ReservationAvailability = z.infer<typeof reservationAvailabilitySchema>;

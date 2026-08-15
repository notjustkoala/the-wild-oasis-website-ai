import { z } from "zod";

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD dates");

export const staySearchInputSchema = z.object({
  startDate: dateOnlySchema.describe("Check-in date in YYYY-MM-DD format"),
  endDate: dateOnlySchema.describe("Checkout date in YYYY-MM-DD format"),
  numGuests: z.number().int().min(1).describe("Total number of guests"),
  maxTotalPrice: z
    .number()
    .positive()
    .optional()
    .describe("Optional maximum cabin total in USD for the whole stay"),
  preferences: z
    .array(z.string().trim().min(1).max(80))
    .max(8)
    .default([])
    .describe("Guest preferences; these do not change availability or price"),
});

export const cabinDetailsInputSchema = z
  .object({
    cabinId: z.number().int().positive(),
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    numGuests: z.number().int().min(1).optional(),
  })
  .refine(
    ({ startDate, endDate }) => Boolean(startDate) === Boolean(endDate),
    "Provide both startDate and endDate, or neither"
  );

export const compareCabinsInputSchema = z.object({
  cabinIds: z.array(z.number().int().positive()).min(2).max(4),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  numGuests: z.number().int().min(1),
});

export const hotelPolicyInputSchema = z.object({});

export type StaySearchInput = z.infer<typeof staySearchInputSchema>;
export type CabinDetailsInput = z.infer<typeof cabinDetailsInputSchema>;
export type CompareCabinsInput = z.infer<typeof compareCabinsInputSchema>;

export type CabinRecommendation = {
  cabinId: number;
  name: string;
  maxCapacity: number;
  image: string;
  description: string;
  regularPrice: number;
  discount: number;
  nightlyPrice: number;
  startDate: string;
  endDate: string;
  numNights: number;
  numGuests: number;
  totalPrice: number;
  withinBudget: boolean | null;
  preferences: string[];
  facts: string[];
  sourceIds: string[];
};

export type SearchAvailableCabinsResult = {
  kind: "cabin-search";
  startDate: string;
  endDate: string;
  numNights: number;
  numGuests: number;
  currency: "USD";
  maxTotalPrice: number | null;
  recommendations: CabinRecommendation[];
  facts: string[];
  sourceIds: string[];
};

export type CabinDetailsResult = {
  kind: "cabin-details";
  cabin: CabinRecommendation | null;
  available: boolean | null;
  facts: string[];
  sourceIds: string[];
};

export type CabinComparisonResult = {
  kind: "cabin-comparison";
  startDate: string;
  endDate: string;
  numNights: number;
  numGuests: number;
  currency: "USD";
  cabins: CabinRecommendation[];
  unavailableCabinIds: number[];
  sourceIds: string[];
};

export type HotelPolicyResult = {
  kind: "hotel-policy";
  minBookingLength: number;
  maxBookingLength: number;
  maxGuestsPerBooking: number;
  breakfastPrice: number;
  currency: "USD";
  facts: string[];
  sourceIds: string[];
};

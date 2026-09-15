import "server-only";

import { tool } from "ai";

import { getStayQuote, validateStay } from "@/app/_lib/booking-domain";
import { privilegedSupabase } from "@/app/_lib/supabase-server";
import {
  cabinDetailsInputSchema,
  compareCabinsInputSchema,
  hotelPolicyInputSchema,
  staySearchInputSchema,
  type CabinComparisonResult,
  type CabinDetailsInput,
  type CabinDetailsResult,
  type CabinRecommendation,
  type CompareCabinsInput,
  type HotelPolicyResult,
  type SearchAvailableCabinsResult,
  type StaySearchInput,
} from "@/app/_ai/schemas/concierge";

export type ConciergeCabinRow = {
  id: number;
  name: string;
  maxCapacity: number;
  regularPrice: number;
  discount: number;
  image: string;
  description: string;
};

export type ConciergeSettingsRow = {
  id: number;
  minBookingLength: number;
  maxBookingLength: number;
  maxGuestsPerBooking: number;
  breakfastPrice: number;
};

export type ConciergeInventoryDataSource = {
  listCabins(): Promise<ConciergeCabinRow[]>;
  getCabins(cabinIds: number[]): Promise<ConciergeCabinRow[]>;
  getCabin(cabinId: number): Promise<ConciergeCabinRow | null>;
  getSettings(): Promise<ConciergeSettingsRow>;
  getConflictingCabinIds(input: {
    cabinIds?: number[];
    startDate: string;
    endDate: string;
  }): Promise<number[]>;
};

function throwReadError(message: string): never {
  throw new Error(message);
}

export const conciergeInventoryDataSource: ConciergeInventoryDataSource = {
  async listCabins() {
    const { data, error } = await privilegedSupabase
      .from("cabins")
      .select("id, name, maxCapacity, regularPrice, discount, image, description")
      .order("name");

    if (error) throwReadError("Cabin inventory could not be loaded");
    return (data ?? []) as ConciergeCabinRow[];
  },

  async getCabins(cabinIds) {
    const uniqueIds = [...new Set(cabinIds)];
    if (uniqueIds.length === 0) return [];

    const { data, error } = await privilegedSupabase
      .from("cabins")
      .select("id, name, maxCapacity, regularPrice, discount, image, description")
      .in("id", uniqueIds);

    if (error) throwReadError("Cabin inventory could not be loaded");
    return (data ?? []) as ConciergeCabinRow[];
  },

  async getCabin(cabinId) {
    const { data, error } = await privilegedSupabase
      .from("cabins")
      .select("id, name, maxCapacity, regularPrice, discount, image, description")
      .eq("id", cabinId)
      .maybeSingle();

    if (error) throwReadError("Cabin details could not be loaded");
    return data as ConciergeCabinRow | null;
  },

  async getSettings() {
    const { data, error } = await privilegedSupabase
      .from("settings")
      .select(
        "id, minBookingLength, maxBookingLength, maxGuestsPerBooking, breakfastPrice"
      )
      .single();

    if (error) throwReadError("Hotel policy could not be loaded");
    return data as ConciergeSettingsRow;
  },

  async getConflictingCabinIds({ cabinIds, startDate, endDate }) {
    let query = privilegedSupabase
      .from("bookings")
      .select("cabinId")
      .lt("startDate", endDate)
      .gt("endDate", startDate)
      .neq("status", "cancelled");

    if (cabinIds?.length) query = query.in("cabinId", [...new Set(cabinIds)]);

    const { data, error } = await query;
    if (error) throwReadError("Cabin availability could not be verified");

    const conflictIds = (data ?? []).map((booking: { cabinId: unknown }) =>
      Number(booking.cabinId)
    );
    return [...new Set<number>(conflictIds)];
  },
};

function assertStayDates(
  startDate: string,
  endDate: string,
  settings: ConciergeSettingsRow
): number {
  const validation = validateStay({
    startDate,
    endDate,
    numGuests: 1,
    maxCapacity: settings.maxGuestsPerBooking,
    minBookingLength: settings.minBookingLength,
    maxBookingLength: settings.maxBookingLength,
  });

  if (!validation.ok) throw new Error(validation.error.message);
  return validation.value.numNights;
}

function buildRecommendation({
  cabin,
  settings,
  startDate,
  endDate,
  numGuests,
  maxTotalPrice,
  preferences = [],
}: {
  cabin: ConciergeCabinRow;
  settings: ConciergeSettingsRow;
  startDate: string;
  endDate: string;
  numGuests: number;
  maxTotalPrice?: number;
  preferences?: string[];
}): CabinRecommendation | null {
  const effectiveCapacity = Math.min(
    cabin.maxCapacity,
    settings.maxGuestsPerBooking
  );
  const validation = validateStay({
    startDate,
    endDate,
    numGuests,
    maxCapacity: effectiveCapacity,
    minBookingLength: settings.minBookingLength,
    maxBookingLength: settings.maxBookingLength,
  });
  if (!validation.ok) return null;

  const quote = getStayQuote({
    startDate: validation.value.startDate,
    endDate: validation.value.endDate,
    regularPrice: cabin.regularPrice,
    discount: cabin.discount,
  });

  const withinBudget = maxTotalPrice
    ? quote.cabinPrice <= maxTotalPrice
    : null;
  const facts = [
    `Sleeps up to ${effectiveCapacity} guests.`,
    `$${quote.nightlyPrice} per night after a $${cabin.discount} discount.`,
    `$${quote.cabinPrice} cabin total for ${quote.numNights} nights.`,
  ];
  if (preferences.length) {
    facts.push(
      `Preferences noted for guest confirmation: ${preferences.join(", ")}.`
    );
  }

  return {
    cabinId: cabin.id,
    name: cabin.name,
    maxCapacity: effectiveCapacity,
    image: cabin.image,
    description: cabin.description,
    regularPrice: cabin.regularPrice,
    discount: cabin.discount,
    nightlyPrice: quote.nightlyPrice,
    startDate: validation.value.startDate,
    endDate: validation.value.endDate,
    numNights: quote.numNights,
    numGuests: validation.value.numGuests,
    totalPrice: quote.cabinPrice,
    withinBudget,
    preferences,
    facts,
    sourceIds: [
      `cabins:${cabin.id}`,
      `settings:${settings.id}`,
      `availability:${cabin.id}:${startDate}:${endDate}`,
    ],
  };
}

export function createConciergeInventoryService(
  dataSource: ConciergeInventoryDataSource = conciergeInventoryDataSource
) {
  return {
    async searchAvailableCabins(
      input: StaySearchInput
    ): Promise<SearchAvailableCabinsResult> {
      const [cabins, settings, conflicts] = await Promise.all([
        dataSource.listCabins(),
        dataSource.getSettings(),
        dataSource.getConflictingCabinIds({
          startDate: input.startDate,
          endDate: input.endDate,
        }),
      ]);
      const numNights = assertStayDates(
        input.startDate,
        input.endDate,
        settings
      );
      const conflictSet = new Set(conflicts);
      const recommendations = cabins
        .filter((cabin) => !conflictSet.has(cabin.id))
        .map((cabin) =>
          buildRecommendation({ cabin, settings, ...input })
        )
        .filter((cabin): cabin is CabinRecommendation => cabin !== null)
        .sort((a, b) => {
          if (a.withinBudget !== b.withinBudget) return a.withinBudget ? -1 : 1;
          return a.totalPrice - b.totalPrice;
        });

      return {
        kind: "cabin-search",
        startDate: input.startDate,
        endDate: input.endDate,
        numNights,
        numGuests: input.numGuests,
        currency: "USD",
        maxTotalPrice: input.maxTotalPrice ?? null,
        recommendations,
        facts: recommendations.length
          ? [
              `${recommendations.length} cabins are available for the requested half-open stay range.`,
              "Prices are calculated by trusted application code from current cabin records.",
            ]
          : ["No cabin currently satisfies the dates and guest count."],
        sourceIds: [
          `settings:${settings.id}`,
          `availability:all:${input.startDate}:${input.endDate}`,
          ...recommendations.map((cabin) => `cabins:${cabin.cabinId}`),
        ],
      };
    },

    async getCabinDetails(
      input: CabinDetailsInput
    ): Promise<CabinDetailsResult> {
      const [cabin, settings] = await Promise.all([
        dataSource.getCabin(input.cabinId),
        dataSource.getSettings(),
      ]);
      if (!cabin) {
        return {
          kind: "cabin-details",
          cabin: null,
          available: null,
          facts: ["The requested cabin does not exist."],
          sourceIds: [`cabins:${input.cabinId}:missing`],
        };
      }

      if (!input.startDate || !input.endDate) {
        const syntheticStart = "2000-01-01";
        const syntheticEnd = "2000-01-02";
        const quote = getStayQuote({
          startDate: syntheticStart,
          endDate: syntheticEnd,
          regularPrice: cabin.regularPrice,
          discount: cabin.discount,
        });
        return {
          kind: "cabin-details",
          cabin: {
            cabinId: cabin.id,
            name: cabin.name,
            maxCapacity: Math.min(
              cabin.maxCapacity,
              settings.maxGuestsPerBooking
            ),
            image: cabin.image,
            description: cabin.description,
            regularPrice: cabin.regularPrice,
            discount: cabin.discount,
            nightlyPrice: quote.nightlyPrice,
            startDate: "",
            endDate: "",
            numNights: 0,
            numGuests: input.numGuests ?? 1,
            totalPrice: 0,
            withinBudget: null,
            preferences: [],
            facts: [
              `Sleeps up to ${Math.min(cabin.maxCapacity, settings.maxGuestsPerBooking)} guests.`,
              `$${quote.nightlyPrice} per night after discount.`,
            ],
            sourceIds: [`cabins:${cabin.id}`, `settings:${settings.id}`],
          },
          available: null,
          facts: ["Provide dates to verify live availability and stay total."],
          sourceIds: [`cabins:${cabin.id}`, `settings:${settings.id}`],
        };
      }

      const conflicts = await dataSource.getConflictingCabinIds({
        cabinIds: [cabin.id],
        startDate: input.startDate,
        endDate: input.endDate,
      });
      const recommendation = buildRecommendation({
        cabin,
        settings,
        startDate: input.startDate,
        endDate: input.endDate,
        numGuests: input.numGuests ?? 1,
      });
      const available = recommendation !== null && !conflicts.includes(cabin.id);

      return {
        kind: "cabin-details",
        cabin: recommendation,
        available,
        facts: available
          ? ["This cabin is currently available for the requested stay."]
          : ["This cabin is unavailable or cannot host the requested party."],
        sourceIds: [
          `cabins:${cabin.id}`,
          `settings:${settings.id}`,
          `availability:${cabin.id}:${input.startDate}:${input.endDate}`,
        ],
      };
    },

    async compareCabins(
      input: CompareCabinsInput
    ): Promise<CabinComparisonResult> {
      const uniqueIds = [...new Set(input.cabinIds)];
      const [cabins, settings, conflicts] = await Promise.all([
        dataSource.getCabins(uniqueIds),
        dataSource.getSettings(),
        dataSource.getConflictingCabinIds({
          cabinIds: uniqueIds,
          startDate: input.startDate,
          endDate: input.endDate,
        }),
      ]);
      const numNights = assertStayDates(
        input.startDate,
        input.endDate,
        settings
      );
      const conflictSet = new Set(conflicts);
      const compared = cabins
        .filter((cabin) => !conflictSet.has(cabin.id))
        .map((cabin) => buildRecommendation({ cabin, settings, ...input }))
        .filter((cabin): cabin is CabinRecommendation => cabin !== null)
        .sort((a, b) => a.totalPrice - b.totalPrice);
      const availableIds = new Set(compared.map((cabin) => cabin.cabinId));

      return {
        kind: "cabin-comparison",
        startDate: input.startDate,
        endDate: input.endDate,
        numNights,
        numGuests: input.numGuests,
        currency: "USD",
        cabins: compared,
        unavailableCabinIds: uniqueIds.filter((id) => !availableIds.has(id)),
        sourceIds: [
          `settings:${settings.id}`,
          ...uniqueIds.map((id) => `cabins:${id}`),
          `availability:compare:${input.startDate}:${input.endDate}`,
        ],
      };
    },

    async getHotelPolicy(): Promise<HotelPolicyResult> {
      const settings = await dataSource.getSettings();
      return {
        kind: "hotel-policy",
        minBookingLength: settings.minBookingLength,
        maxBookingLength: settings.maxBookingLength,
        maxGuestsPerBooking: settings.maxGuestsPerBooking,
        breakfastPrice: settings.breakfastPrice,
        currency: "USD",
        facts: [
          `Stays must be ${settings.minBookingLength}-${settings.maxBookingLength} nights.`,
          `A booking can include at most ${settings.maxGuestsPerBooking} guests, subject to cabin capacity.`,
          `Breakfast is $${settings.breakfastPrice} per guest per day.`,
        ],
        sourceIds: [`settings:${settings.id}`],
      };
    },
  };
}

export function createCabinTools(
  dataSource: ConciergeInventoryDataSource = conciergeInventoryDataSource
) {
  const service = createConciergeInventoryService(dataSource);
  return {
    searchAvailableCabins: tool({
      description:
        "Search current cabin availability and calculate trusted totals for complete dates and a guest count.",
      inputSchema: staySearchInputSchema,
      execute: (input) => service.searchAvailableCabins(input),
    }),
    getCabinDetails: tool({
      description:
        "Load factual cabin details and optionally verify availability and calculate a stay total.",
      inputSchema: cabinDetailsInputSchema,
      execute: (input) => service.getCabinDetails(input),
    }),
    compareCabins: tool({
      description:
        "Compare two to four current, available cabins using totals calculated by application code.",
      inputSchema: compareCabinsInputSchema,
      execute: (input) => service.compareCabins(input),
    }),
    getHotelPolicy: tool({
      description: "Load only live stay-length limits, guest limits, and the current breakfast price.",
      inputSchema: hotelPolicyInputSchema,
      execute: () => service.getHotelPolicy(),
    }),
  };
}

export const cabinTools = createCabinTools();

// Keep this module read-only: availability and pricing tools never mutate bookings.
export const INVENTORY_RANGE_SEMANTICS = "[startDate,endDate)" as const;

import { getStayQuote, toDateOnly, validateStay } from "./booking-domain";
import {
  bookingInputSchema,
  bookingUpdateInputSchema,
  type BookingInput,
  type BookingUpdateInput,
} from "./booking-schema";

export type CreateBookingInput = BookingInput;
export type UpdateBookingInput = BookingUpdateInput;

type Cabin = {
  id: number;
  regularPrice: number;
  discount: number;
  maxCapacity: number;
};

type Settings = {
  minBookingLength: number;
  maxBookingLength: number;
  maxGuestsPerBooking: number;
};

type BookingRulesRepository = {
  getCabin(cabinId: number): Promise<Cabin | null>;
  getSettings(): Promise<Settings | null>;
};

type CreateBookingRepository = BookingRulesRepository & {
  findConflicts(input: {
    cabinId: number;
    startDate: string;
    endDate: string;
  }): Promise<Array<{ id: number }>>;
  insert(booking: Record<string, unknown>): Promise<unknown>;
};

type UpdateBookingRepository = BookingRulesRepository & {
  getOwnedBooking(
    bookingId: number,
    guestId: number
  ): Promise<{
    id: number;
    cabinId: number;
    guestId: number;
  } | null>;
  updateForGuest(input: {
    bookingId: number;
    guestId: number;
    changes: { numGuests: number; observations: string };
  }): Promise<unknown | null>;
};

function toPositiveInteger(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive whole number`);
  }
  return parsed;
}

function getTrustedGuestLimit(cabin: Cabin, settings: Settings): number {
  const cabinCapacity = toPositiveInteger(cabin.maxCapacity, "Cabin capacity");
  const bookingLimit = toPositiveInteger(
    settings.maxGuestsPerBooking,
    "Maximum guests per booking"
  );

  return Math.min(cabinCapacity, bookingLimit);
}

function assertGuestCountWithinLimit(
  numGuests: number,
  cabin: Cabin,
  settings: Settings
) {
  const maxGuests = getTrustedGuestLimit(cabin, settings);
  if (numGuests > maxGuests) {
    throw new Error(`This booking can include at most ${maxGuests} guests`);
  }
  return maxGuests;
}

export async function createVerifiedBooking({
  input,
  guestId: rawGuestId,
  repository,
  now = new Date(),
}: {
  input: unknown;
  guestId: number | string;
  repository: CreateBookingRepository;
  now?: Date;
}) {
  const parsedInput = bookingInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new Error("Booking input is invalid");
  }

  // safeParse narrows untrusted form values to the schema's inferred type.
  const trustedInput: BookingInput = parsedInput.data;
  const cabinId = trustedInput.cabinId;
  const guestId = toPositiveInteger(rawGuestId, "Guest ID");
  const numGuests = trustedInput.numGuests;

  const [cabin, settings] = await Promise.all([
    repository.getCabin(cabinId),
    repository.getSettings(),
  ]);

  if (!cabin) throw new Error("Cabin could not be found");
  if (!settings) throw new Error("Booking settings could not be loaded");

  const maxGuests = assertGuestCountWithinLimit(numGuests, cabin, settings);

  const validation = validateStay({
    startDate: trustedInput.startDate,
    endDate: trustedInput.endDate,
    numGuests,
    maxCapacity: maxGuests,
    minBookingLength: settings.minBookingLength,
    maxBookingLength: settings.maxBookingLength,
  });

  if (!validation.ok) throw new Error(validation.error.message);
  if (validation.value.startDate < toDateOnly(now)) {
    throw new Error("Start date cannot be in the past");
  }

  const conflicts = await repository.findConflicts({
    cabinId,
    startDate: validation.value.startDate,
    endDate: validation.value.endDate,
  });
  if (conflicts.length > 0) {
    throw new Error("Cabin is no longer available for the selected dates");
  }

  const quote = getStayQuote({
    startDate: validation.value.startDate,
    endDate: validation.value.endDate,
    regularPrice: Number(cabin.regularPrice),
    discount: Number(cabin.discount),
  });

  const booking = {
    cabinId,
    guestId,
    startDate: validation.value.startDate,
    endDate: validation.value.endDate,
    numNights: validation.value.numNights,
    numGuests: validation.value.numGuests,
    observations: trustedInput.observations,
    cabinPrice: quote.cabinPrice,
    extrasPrice: 0,
    totalPrice: quote.cabinPrice,
    isPaid: false,
    hasBreakfast: false,
    status: "unconfirmed",
  };

  await repository.insert(booking);
  return booking;
}

export async function updateVerifiedBooking({
  input,
  guestId: rawGuestId,
  repository,
}: {
  input: unknown;
  guestId: number | string;
  repository: UpdateBookingRepository;
}) {
  const parsedInput = bookingUpdateInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new Error("Booking update input is invalid");
  }

  const trustedInput: BookingUpdateInput = parsedInput.data;
  const guestId = toPositiveInteger(rawGuestId, "Guest ID");
  const bookingId = trustedInput.bookingId;

  const booking = await repository.getOwnedBooking(bookingId, guestId);
  if (!booking || Number(booking.guestId) !== guestId) {
    throw new Error("You are not allowed to edit the booking");
  }

  const cabinId = toPositiveInteger(booking.cabinId, "Cabin ID");
  const [cabin, settings] = await Promise.all([
    repository.getCabin(cabinId),
    repository.getSettings(),
  ]);

  if (!cabin) throw new Error("Cabin could not be found");
  if (!settings) throw new Error("Booking settings could not be loaded");

  assertGuestCountWithinLimit(trustedInput.numGuests, cabin, settings);

  const changes = {
    numGuests: trustedInput.numGuests,
    observations: trustedInput.observations,
  };
  const updated = await repository.updateForGuest({
    bookingId,
    guestId,
    changes,
  });

  if (!updated) throw new Error("You are not allowed to edit the booking");

  return { bookingId, cabinId, ...changes };
}

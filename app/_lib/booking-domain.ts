const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateInput = Date | string | null | undefined;

export type BookingValidationCode =
  | "INVALID_DATE"
  | "INVALID_STAY_LENGTH"
  | "INVALID_GUEST_COUNT"
  | "CABIN_CAPACITY_EXCEEDED";

export type BookingValidationResult =
  | {
      ok: true;
      value: {
        startDate: string;
        endDate: string;
        numNights: number;
        numGuests: number;
      };
    }
  | {
      ok: false;
      error: { code: BookingValidationCode; message: string };
    };

type StayQuoteInput = {
  startDate: DateInput;
  endDate: DateInput;
  regularPrice: number;
  discount?: number;
};

type ValidateStayInput = {
  startDate: DateInput;
  endDate: DateInput;
  numGuests: number;
  maxCapacity: number;
  minBookingLength: number;
  maxBookingLength: number;
};

export type SelectableDateRange = {
  from?: DateInput;
  to?: DateInput;
};

function toUtcDay(dateOnly: string): number {
  const match = DATE_ONLY_PATTERN.exec(dateOnly);
  if (!match) throw new Error("Date must use YYYY-MM-DD format");

  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    throw new Error("Date is not a valid calendar date");
  }

  return timestamp;
}

export function toDateOnly(value: DateInput): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Date is invalid");
    const year = String(value.getFullYear()).padStart(4, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (typeof value !== "string") throw new Error("Date is required");
  toUtcDay(value);
  return value;
}

export function getNumNights(startDate: DateInput, endDate: DateInput): number {
  const start = toUtcDay(toDateOnly(startDate));
  const end = toUtcDay(toDateOnly(endDate));
  return (end - start) / DAY_IN_MS;
}

export function getStayQuote({
  startDate,
  endDate,
  regularPrice,
  discount = 0,
}: StayQuoteInput) {
  if (!Number.isFinite(regularPrice) || regularPrice < 0) {
    throw new Error("Regular price must be a non-negative number");
  }
  if (!Number.isFinite(discount) || discount < 0 || discount > regularPrice) {
    throw new Error("Discount must be between zero and the regular price");
  }

  const nightlyPrice = regularPrice - discount;
  if (!startDate || !endDate) {
    return { nightlyPrice, numNights: 0, cabinPrice: 0 };
  }

  const numNights = getNumNights(startDate, endDate);
  return {
    nightlyPrice,
    numNights,
    cabinPrice: numNights > 0 ? numNights * nightlyPrice : 0,
  };
}

export function validateStay({
  startDate,
  endDate,
  numGuests,
  maxCapacity,
  minBookingLength,
  maxBookingLength,
}: ValidateStayInput): BookingValidationResult {
  let normalizedStartDate: string;
  let normalizedEndDate: string;
  let numNights: number;

  try {
    normalizedStartDate = toDateOnly(startDate);
    normalizedEndDate = toDateOnly(endDate);
    numNights = getNumNights(normalizedStartDate, normalizedEndDate);
  } catch {
    return {
      ok: false,
      error: { code: "INVALID_DATE", message: "Please select valid dates" },
    };
  }

  if (
    !Number.isInteger(numNights) ||
    numNights < minBookingLength ||
    numNights > maxBookingLength
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_STAY_LENGTH",
        message: `Stay length must be between ${minBookingLength} and ${maxBookingLength} nights`,
      },
    };
  }

  if (!Number.isInteger(numGuests) || numGuests < 1) {
    return {
      ok: false,
      error: {
        code: "INVALID_GUEST_COUNT",
        message: "Guest count must be a positive whole number",
      },
    };
  }

  if (numGuests > maxCapacity) {
    return {
      ok: false,
      error: {
        code: "CABIN_CAPACITY_EXCEEDED",
        message: `This cabin can host at most ${maxCapacity} guests`,
      },
    };
  }

  return {
    ok: true,
    value: {
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      numNights,
      numGuests,
    },
  };
}

export function stayRangesOverlap(
  first: { startDate: DateInput; endDate: DateInput },
  second: { startDate: DateInput; endDate: DateInput }
): boolean {
  const firstStart = toUtcDay(toDateOnly(first.startDate));
  const firstEnd = toUtcDay(toDateOnly(first.endDate));
  const secondStart = toUtcDay(toDateOnly(second.startDate));
  const secondEnd = toUtcDay(toDateOnly(second.endDate));

  return firstStart < secondEnd && secondStart < firstEnd;
}

/**
 * Checks a proposed UI range against occupied nights using [check-in, checkout)
 * semantics. An occupied day can therefore be selected as checkout, but not as
 * check-in or crossed as a night of the new stay.
 */
export function isStayRangeAvailable(
  range: SelectableDateRange | undefined,
  occupiedNights: DateInput[]
): boolean {
  if (!range?.from) return true;

  let start: number;
  let end: number | undefined;

  try {
    start = toUtcDay(toDateOnly(range.from));
    end = range.to ? toUtcDay(toDateOnly(range.to)) : undefined;
  } catch {
    return false;
  }

  if (end !== undefined && end <= start) return false;

  return !occupiedNights.some((date) => {
    let occupied: number;
    try {
      occupied = toUtcDay(toDateOnly(date));
    } catch {
      return true;
    }

    if (end === undefined) return occupied === start;
    return occupied >= start && occupied < end;
  });
}

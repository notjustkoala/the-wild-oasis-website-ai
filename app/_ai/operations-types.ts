import { z } from "zod";

import type { PolicySearchResult } from "@/app/_ai/policies/policy-types";

export const operationsDateRangeSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export const bookingIdListSchema = z
  .object({
    bookingIds: z.array(z.number().int().positive()).min(1).max(25),
  })
  .strict();

export const internalNoteDraftSchema = z
  .object({
    bookingId: z.number().int().positive(),
    note: z.string().trim().min(1).max(500),
  })
  .strict();

export type OperationsDateRange = z.infer<typeof operationsDateRangeSchema>;

export const OPERATIONS_RESULT_LIMITS = {
  arrivals: 100,
  metrics: 500,
  cabinPerformance: 500,
  risks: 100,
  details: 25,
} as const;

/** Per-tool hard caps for stable, bounded database scans. */
export const OPERATIONS_MAX_ROWS = {
  metrics: 2_000,
  cabinPerformance: 2_000,
  risks: 2_000,
} as const;

/** The database constraint currently permits these four booking statuses. */
export const OPERATIONS_STATUS_KEYS = [
  "unconfirmed",
  "checked-in",
  "checked-out",
  "cancelled",
] as const;

type OperationsToolResultBase = {
  facts: string[];
  sourceIds: string[];
  truncated: boolean;
};

export type BookingSummary = {
  bookingId: number;
  cabinId: number;
  cabinName: string;
  arrivalDate: string;
  departureDate: string;
  status: string;
  isPaid: boolean;
  numGuests: number;
  totalPrice: number;
  riskTags: string[];
  sourceIds: string[];
};

export type OperationsToolResult =
  | (OperationsToolResultBase & { kind: "arrivals"; arrivals: BookingSummary[] })
  | (OperationsToolResultBase & {
      kind: "booking-metrics";
      metrics: {
        totalBookings: number;
        totalRevenue: number;
        extrasRevenue: number;
        paidBookings: number;
        unpaidBookings: number;
        byStatus: Record<string, number>;
        currency: "USD";
        dateBasis: "created_at";
        revenueBasis: "totalPrice";
        includesCancelled: true;
      };
    })
  | (OperationsToolResultBase & {
      kind: "cabin-performance";
      cabins: Array<{
        cabinId: number;
        cabinName: string;
        bookings: number;
        nights: number;
        revenue: number;
        sourceIds: string[];
      }>;
    })
  | (OperationsToolResultBase & { kind: "booking-risks"; risks: BookingSummary[] })
  | (OperationsToolResultBase & { kind: "booking-details"; bookings: BookingSummary[] })
  | PolicySearchResult
  | ApprovalProposal;

export type ApprovalProposal = {
  kind: "internal-note-approval";
  approvalId: string;
  bookingId: number;
  note: string;
  status: "pending";
  sourceIds: string[];
  facts: string[];
  truncated: false;
};

export function parseOperationsDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function operationsDateText(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Resolve only unambiguous, bounded relative date phrases. The server-provided
 * reference date keeps a streamed request deterministic across tool calls.
 */
export function resolveRelativeOperationsDateRange(text: string, referenceDate: Date): OperationsDateRange | null {
  const reference = parseOperationsDate(operationsDateText(referenceDate));
  if (!reference) return null;

  const normalized = text.toLocaleLowerCase();
  if (/\btoday\b/u.test(normalized) || normalized.includes("今天")) {
    const date = operationsDateText(reference);
    return { from: date, to: date };
  }
  if (/\btomorrow\b/u.test(normalized) || normalized.includes("明天")) {
    const date = new Date(reference);
    date.setUTCDate(date.getUTCDate() + 1);
    const dateText = operationsDateText(date);
    return { from: dateText, to: dateText };
  }

  const match = /\bnext\s+(\d{1,3})\s+days?\b|(?:未来|接下来)\s*(\d{1,3}|七)\s*天/u.exec(normalized);
  if (!match) return null;
  const relativeDays = match[1] ?? match[2];
  const days = relativeDays === "七" ? 7 : Number(relativeDays);
  if (!Number.isInteger(days) || days < 1 || days > 366) return null;

  const end = new Date(reference);
  end.setUTCDate(end.getUTCDate() + days - 1);
  return { from: operationsDateText(reference), to: operationsDateText(end) };
}

/**
 * Validate an explicitly supplied pair of ISO dates without guessing which
 * date the employee intended. Only exactly two date tokens are accepted.
 */
export function extractExplicitOperationsDateRange(text: string, maxDays = 366): OperationsDateRange | null {
  const matches = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (matches.length !== 2) return null;
  const from = parseOperationsDate(matches[0]);
  const to = parseOperationsDate(matches[1]);
  if (!from || !to || to < from) return null;
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > maxDays) return null;
  return { from: matches[0], to: matches[1] };
}

/** Add a deterministic date hint to the sanitized user message for the model. */
export function addRelativeOperationsDateHint(text: string, referenceDate: Date, sourceText = text) {
  const explicitRange = extractExplicitOperationsDateRange(sourceText);
  if (explicitRange) {
    return `${text}\n[Server-validated date range: from=${explicitRange.from}, to=${explicitRange.to} (inclusive). Use these exact bounded dates without asking the employee to restate them.]`;
  }
  const range = resolveRelativeOperationsDateRange(sourceText, referenceDate);
  if (!range) return text;
  return `${text}\n[Server-resolved date range: from=${range.from}, to=${range.to} (inclusive). Use these exact bounded dates without asking the employee to restate them.]`;
}

export function assertOperationsDateRange(
  range: OperationsDateRange,
  maxDays = 366
) {
  const from = parseOperationsDate(range.from);
  const to = parseOperationsDate(range.to);
  if (!from || !to || to < from) {
    throw new Error("The date range is invalid.");
  }
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > maxDays) {
    throw new Error(`The date range cannot exceed ${maxDays} days.`);
  }
  return { from, to, days };
}

export function nextDate(value: string) {
  const date = parseOperationsDate(value);
  if (!date) throw new Error("The date is invalid.");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function compareSourceIds(left: string, right: string) {
  const leftMatch = /^(.*?):(\d+)$/.exec(left);
  const rightMatch = /^(.*?):(\d+)$/.exec(right);
  if (!leftMatch || !rightMatch) return left.localeCompare(right);
  return leftMatch[1].localeCompare(rightMatch[1]) || Number(leftMatch[2]) - Number(rightMatch[2]);
}

/** Keep evidence order deterministic and avoid repeating the same source. */
export function stableSourceIds(sourceIds: Iterable<string>) {
  return [...new Set(sourceIds)].sort(compareSourceIds);
}

export function getNestedObject(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return getNestedObject(value[0]);
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function toNumber(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

export function deriveRiskTags(observation: unknown): string[] {
  const value = typeof observation === "string" ? observation.toLowerCase() : "";
  const tags = new Set<string>();
  if (/(allerg|gluten|vegan|vegetarian|无麸|过敏|素食)/i.test(value)) tags.add("food-allergy");
  if (/(late|after \d|midnight|深夜|晚到)/i.test(value)) tags.add("late-arrival");
  if (/(pet|dog|cat|宠物)/i.test(value)) tags.add("pet");
  if (/(birthday|anniversary|celebrat|周年|纪念)/i.test(value)) tags.add("celebration");
  if (/(extra bed|crib|baby|加床|婴儿床)/i.test(value)) tags.add("extra-bed");
  return [...tags];
}

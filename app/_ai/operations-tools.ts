import "server-only";

import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { createOperationsApproval } from "@/app/_ai/operations-approval";
import {
  assertOperationsDateRange,
  bookingIdListSchema,
  deriveRiskTags,
  getNestedObject,
  nextDate,
  OPERATIONS_STATUS_KEYS,
  OPERATIONS_MAX_ROWS,
  OPERATIONS_RESULT_LIMITS,
  operationsDateRangeSchema,
  toNumber,
  stableSourceIds,
  type BookingSummary,
  type OperationsToolResult,
} from "@/app/_ai/operations-types";

type OperationsToolDependencies = {
  client: { from: (table: string) => unknown };
  actorId: string;
  now?: () => Date;
};

type BookingRow = Record<string, unknown>;

type PagedRows = { rows: BookingRow[]; truncated: boolean; error: unknown };

function query(client: OperationsToolDependencies["client"], table: string) {
  return client.from(table) as any;
}

async function fetchBoundedRows(
  fetchPage: (offset: number, limit: number) => Promise<{ data: unknown; error: unknown }>,
  pageSize: number,
  maxRows: number,
): Promise<PagedRows> {
  const rows: BookingRow[] = [];
  let offset = 0;
  while (rows.length < maxRows) {
    const remaining = maxRows - rows.length;
    const acceptedPageSize = Math.min(pageSize, remaining);
    const result = await fetchPage(offset, acceptedPageSize + 1);
    if (result.error) return { rows, truncated: false, error: result.error };
    const page = Array.isArray(result.data) ? result.data as BookingRow[] : [];
    rows.push(...page.slice(0, acceptedPageSize));
    if (page.length <= acceptedPageSize) {
      return { rows, truncated: false, error: null };
    }
    if (rows.length >= maxRows) {
      return { rows, truncated: true, error: null };
    }
    offset += acceptedPageSize;
  }
  return { rows, truncated: false, error: null };
}

function pagedBuilder(builder: any, offset: number, limit: number) {
  return typeof builder.range === "function"
    ? builder.range(offset, offset + limit - 1).limit(limit)
    : builder.limit(limit);
}

function sourceIdsForBooking(booking: Record<string, unknown>) {
  const id = Number(booking.id);
  const cabinId = Number(booking.cabinId);
  return stableSourceIds([`booking:${id}`, `cabin:${cabinId}`]);
}

function summary(booking: Record<string, unknown>): BookingSummary {
  const cabin = getNestedObject(booking.cabins);
  const sourceIds = sourceIdsForBooking(booking);
  return {
    bookingId: Number(booking.id),
    cabinId: Number(booking.cabinId),
    cabinName: String(cabin.name ?? "Unknown cabin"),
    arrivalDate: String(booking.startDate).slice(0, 10),
    departureDate: String(booking.endDate).slice(0, 10),
    status: String(booking.status),
    isPaid: Boolean(booking.isPaid),
    numGuests: toNumber(booking.numGuests),
    totalPrice: toNumber(booking.totalPrice),
    riskTags: deriveRiskTags(booking.observations),
    sourceIds,
  };
}

function rangeFacts(range: { from: string; to: string }) {
  return [`Bookings from ${range.from} through ${range.to} (inclusive).`];
}

export function createOperationsTools({ client, actorId, now = () => new Date() }: OperationsToolDependencies) {
  const getArrivals = tool({
    description: "List non-cancelled arrivals in a bounded date range; historical ranges are allowed for reporting.",
    inputSchema: operationsDateRangeSchema,
    execute: async (input) => {
      assertOperationsDateRange(input, 31);
      const { data, error } = await query(client, "bookings")
        .select('id,"cabinId",startDate,endDate,status,"isPaid","numGuests",totalPrice,observations,cabins(name)')
        .gte("startDate", input.from)
        .lt("startDate", nextDate(input.to))
        .neq("status", "cancelled")
        .order("startDate", { ascending: true })
        .order("id", { ascending: true })
        .limit(OPERATIONS_RESULT_LIMITS.arrivals + 1);
      if (error) throw new Error("Arrivals could not be loaded.");
      const rows = data as BookingRow[] | null ?? [];
      const truncated = rows.length > OPERATIONS_RESULT_LIMITS.arrivals;
      const arrivals = rows
        .slice(0, OPERATIONS_RESULT_LIMITS.arrivals)
        .map(summary)
        .sort((left, right) => left.arrivalDate.localeCompare(right.arrivalDate) || left.bookingId - right.bookingId);
      return {
        kind: "arrivals",
        arrivals,
        truncated,
        facts: [...rangeFacts(input), `${arrivals.length} arrivals found.`],
        sourceIds: stableSourceIds(arrivals.flatMap((item) => item.sourceIds)),
      } satisfies OperationsToolResult;
    },
  });

  const getBookingMetrics = tool({
    description: "Return dashboard-aligned booking count, revenue, payment, and status metrics.",
    inputSchema: operationsDateRangeSchema,
    execute: async (input) => {
      assertOperationsDateRange(input, 366);
      const paged = await fetchBoundedRows((offset, limit) => {
        const builder = query(client, "bookings")
          .select('id,status,totalPrice,extrasPrice,"isPaid",created_at')
          .gte("created_at", input.from)
          .lt("created_at", nextDate(input.to))
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });
        return pagedBuilder(builder, offset, limit);
      }, OPERATIONS_RESULT_LIMITS.metrics, OPERATIONS_MAX_ROWS.metrics);
      if (paged.error) throw new Error("Booking metrics could not be loaded.");
      const rows = paged.rows;
      const byStatus = rows.reduce<Record<string, number>>((result, row) => {
        const status = String(row.status);
        result[status] = (result[status] ?? 0) + 1;
        return result;
      }, {});
      const stableStatus = Object.fromEntries([
        ...OPERATIONS_STATUS_KEYS.map((status) => [status, byStatus[status] ?? 0] as const),
        ...Object.entries(byStatus)
          .filter(([status]) => !(OPERATIONS_STATUS_KEYS as readonly string[]).includes(status))
          .sort(([left], [right]) => left.localeCompare(right)),
      ]);
      // The dashboard's Stats component sums totalPrice. In this schema that
      // value already includes extrasPrice; adding extrasPrice again would
      // double-count the same booking revenue.
      const revenue = rows.reduce((total, row) => total + toNumber(row.totalPrice), 0);
      const extrasRevenue = rows.reduce((total, row) => total + toNumber(row.extrasPrice), 0);
      const paid = rows.filter((row) => Boolean(row.isPaid)).length;
      return {
        kind: "booking-metrics",
        metrics: {
          totalBookings: rows.length,
          totalRevenue: Math.round(revenue * 100) / 100,
          extrasRevenue: Math.round(extrasRevenue * 100) / 100,
          paidBookings: paid,
          unpaidBookings: rows.length - paid,
          byStatus: stableStatus,
          currency: "USD",
          dateBasis: "created_at",
          revenueBasis: "totalPrice",
          includesCancelled: true,
        },
        truncated: paged.truncated,
        facts: [...rangeFacts(input), `Created-at window; ${rows.length} bookings found, including cancelled bookings. Dashboard revenue sums totalPrice; extrasPrice is reported separately and is not added again.`, paged.truncated ? `Partial result: capped at ${OPERATIONS_MAX_ROWS.metrics} bookings.` : "Complete result within the server cap."],
        sourceIds: stableSourceIds(rows.map((row) => `booking:${Number(row.id)}`)),
      } satisfies OperationsToolResult;
    },
  });

  const getCabinPerformance = tool({
    description: "Compare cabin booking count, nights, and revenue for a bounded range.",
    inputSchema: operationsDateRangeSchema,
    execute: async (input) => {
      assertOperationsDateRange(input, 366);
      const paged = await fetchBoundedRows((offset, limit) => {
        const builder = query(client, "bookings")
          .select('id,"cabinId",numNights,totalPrice,status,cabins(name)')
          .gte("startDate", input.from)
          .lt("startDate", nextDate(input.to))
          .neq("status", "cancelled")
          .order("startDate", { ascending: true })
          .order("id", { ascending: true });
        return pagedBuilder(builder, offset, limit);
      }, OPERATIONS_RESULT_LIMITS.cabinPerformance, OPERATIONS_MAX_ROWS.cabinPerformance);
      if (paged.error) throw new Error("Cabin performance could not be loaded.");
      const grouped = new Map<number, { cabinId: number; cabinName: string; bookings: number; nights: number; revenue: number; sourceIds: string[] }>();
      for (const row of paged.rows) {
        const cabin = getNestedObject(row.cabins);
        const cabinId = Number(row.cabinId);
        const item = grouped.get(cabinId) ?? { cabinId, cabinName: String(cabin.name ?? "Unknown cabin"), bookings: 0, nights: 0, revenue: 0, sourceIds: [] };
        item.bookings += 1;
        item.nights += toNumber(row.numNights);
        item.revenue += toNumber(row.totalPrice);
        item.sourceIds.push(`booking:${Number(row.id)}`);
        grouped.set(cabinId, item);
      }
      const cabins = [...grouped.values()]
        .sort((left, right) => left.cabinId - right.cabinId)
        .map((item) => ({
          ...item,
          revenue: Math.round(item.revenue * 100) / 100,
          sourceIds: stableSourceIds([...item.sourceIds, `cabin:${item.cabinId}`]),
        }));
      return {
        kind: "cabin-performance",
        cabins,
        truncated: paged.truncated,
        facts: [...rangeFacts(input), `${cabins.length} cabins had active bookings.`, paged.truncated ? `Partial result: capped at ${OPERATIONS_MAX_ROWS.cabinPerformance} bookings.` : "Complete result within the server cap."],
        sourceIds: stableSourceIds(cabins.flatMap((item) => item.sourceIds)),
      } satisfies OperationsToolResult;
    },
  });

  const getBookingRisks = tool({
    description: "Find operational booking risks using server-side rules; never returns raw observations.",
    inputSchema: operationsDateRangeSchema,
    execute: async (input) => {
      assertOperationsDateRange(input, 31);
      const paged = await fetchBoundedRows((offset, limit) => {
        const builder = query(client, "bookings")
          .select('id,"cabinId",startDate,endDate,status,"isPaid","numGuests",totalPrice,observations,cabins(name)')
          .gte("startDate", input.from)
          .lt("startDate", nextDate(input.to))
          .neq("status", "cancelled")
          .order("startDate", { ascending: true })
          .order("id", { ascending: true });
        return pagedBuilder(builder, offset, limit);
      }, 500, OPERATIONS_MAX_ROWS.risks);
      if (paged.error) throw new Error("Booking risks could not be loaded.");
      const matchingRisks = paged.rows
        .map(summary)
        .filter((item) => item.riskTags.length || !item.isPaid)
        .sort((left, right) => left.arrivalDate.localeCompare(right.arrivalDate) || left.bookingId - right.bookingId);
      const truncated = paged.truncated || matchingRisks.length > OPERATIONS_RESULT_LIMITS.risks;
      const risks = matchingRisks.slice(0, OPERATIONS_RESULT_LIMITS.risks);
      return {
        kind: "booking-risks",
        risks,
        truncated,
        facts: [
          ...rangeFacts(input),
          `${risks.length} bookings require operational attention.`,
          paged.truncated
            ? `Partial result: risk scan capped at ${OPERATIONS_MAX_ROWS.risks} candidate bookings.`
            : matchingRisks.length > OPERATIONS_RESULT_LIMITS.risks
              ? `Partial result: showing the first ${OPERATIONS_RESULT_LIMITS.risks} risk bookings.`
              : "Complete result within the server cap.",
        ],
        sourceIds: stableSourceIds(risks.flatMap((item) => item.sourceIds)),
      } satisfies OperationsToolResult;
    },
  });

  const getBookingDetails = tool({
    description: "Return minimal non-PII details for up to 25 explicitly identified bookings.",
    inputSchema: bookingIdListSchema,
    execute: async ({ bookingIds }) => {
      const { data, error } = await query(client, "bookings")
        .select('id,"cabinId",startDate,endDate,status,"isPaid","numGuests",totalPrice,observations,cabins(name)')
        .in("id", bookingIds)
        .limit(OPERATIONS_RESULT_LIMITS.details);
      if (error) throw new Error("Booking details could not be loaded.");
      const details = (data as BookingRow[] | null ?? []).map(summary).sort((left, right) => left.bookingId - right.bookingId);
      return {
        kind: "booking-details",
        bookings: details,
        // The input schema already caps requests at the same limit. Finding all
        // 25 requested rows is therefore complete, not evidence of truncation.
        truncated: bookingIds.length > OPERATIONS_RESULT_LIMITS.details,
        facts: [`${details.length} of ${bookingIds.length} requested bookings found.`],
        sourceIds: stableSourceIds(details.flatMap((item) => item.sourceIds)),
      } satisfies OperationsToolResult;
    },
  });

  const addBookingInternalNote = tool({
    description: "Draft an internal follow-up note for one booking. This creates an approval request only; it never changes booking data.",
    inputSchema: z.object({ bookingId: z.number().int().positive(), note: z.string().trim().min(1).max(500) }).strict(),
    execute: async ({ bookingId, note }) => {
      const { data, error } = await query(client, "bookings")
        .select('id')
        .eq("id", bookingId)
        .maybeSingle();
      if (error || !data) throw new Error("Booking not found.");
      const proposal = await createOperationsApproval({ client, actorId, bookingId, note, now });
      return proposal;
    },
  });

  return { getArrivals, getBookingMetrics, getCabinPerformance, getBookingRisks, getBookingDetails, addBookingInternalNote } satisfies ToolSet;
}

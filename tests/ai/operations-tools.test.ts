import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertOperationsDateRange,
  compareSourceIds,
  deriveRiskTags,
  nextDate,
  OPERATIONS_MAX_ROWS,
  OPERATIONS_RESULT_LIMITS,
} from "@/app/_ai/operations-types";
import { createOperationsTools } from "@/app/_ai/operations-tools";

type QueryResult = { data: unknown; error: unknown };

function chain(result: QueryResult, { paginate = false } = {}): Record<string, any> {
  let selectedRange: { from: number; to: number } | null = null;
  const builder: Record<string, any> = {
    select: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      selectedRange = { from, to };
      return builder;
    }),
    limit: vi.fn((limit: number) => {
      if (!paginate || !selectedRange || !Array.isArray(result.data)) {
        return Promise.resolve(result);
      }
      const data = result.data
        .slice(selectedRange.from, selectedRange.to + 1)
        .slice(0, limit);
      return Promise.resolve({ data, error: result.error });
    }),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  builder.then = (resolveResult: (value: unknown) => unknown) => Promise.resolve(result).then(resolveResult);
  return builder;
}

function metricRow(id: number) {
  return {
    id,
    status: id % 2 ? "unconfirmed" : "checked-in",
    totalPrice: 100,
    extrasPrice: 10,
    isPaid: id % 2 === 0,
    created_at: "2026-09-01T00:00:00Z",
  };
}

function cabinRow(id: number) {
  return {
    id,
    cabinId: id % 2 ? 1 : 2,
    numNights: 2,
    totalPrice: 100,
    status: "unconfirmed",
    startDate: "2026-09-01T00:00:00Z",
    cabins: { name: id % 2 ? "Cabin 001" : "Cabin 002" },
  };
}

function operationsRow(id: number, startDate = "2026-09-01T00:00:00Z") {
  return {
    id,
    cabinId: 1,
    startDate,
    endDate: "2026-09-02T00:00:00Z",
    status: "unconfirmed",
    isPaid: false,
    numGuests: 2,
    totalPrice: 100,
    observations: "Late arrival",
    cabins: { name: "Cabin 001" },
  };
}

describe("operations copilot fixed tools", () => {
  it("registers policy search beside the existing operations tools", () => {
    const tools = createOperationsTools({ client: { from: vi.fn(), rpc: vi.fn() }, actorId: "actor-1" });
    expect(Object.keys(tools)).toContain("searchHotelPolicies");
  });
  it("rejects malformed and overlong date ranges", () => {
    expect(() => assertOperationsDateRange({ from: "2026-02-30", to: "2026-03-01" })).toThrow();
    expect(() => assertOperationsDateRange({ from: "2026-01-01", to: "2027-01-02" }, 31)).toThrow(/31/);
    expect(nextDate("2026-02-28")).toBe("2026-03-01");
  });

  it("derives operational tags without exposing the source observation", async () => {
    expect(deriveRiskTags("Guest has a peanut allergy and will arrive late")).toEqual([
      "food-allergy",
      "late-arrival",
    ]);
    const bookings = [{
      id: 10,
      cabinId: 2,
      startDate: "2026-09-01T00:00:00Z",
      endDate: "2026-09-03T00:00:00Z",
      status: "unconfirmed",
      isPaid: false,
      numGuests: 2,
      totalPrice: 450,
      observations: "Guest has a peanut allergy",
      cabins: { name: "Cabin 002" },
    }];
    const calls: string[] = [];
    const client = {
      from(table: string) {
        calls.push(table);
        return chain({ data: bookings, error: null });
      },
    };
    const tools = createOperationsTools({ client, actorId: "actor-1" });
    const output = await tools.getBookingRisks.execute!({ from: "2026-09-01", to: "2026-09-01" }, {} as never) as any;
    expect(output.risks[0]).toMatchObject({ bookingId: 10, riskTags: ["food-allergy"] });
    expect(output.risks[0]).not.toHaveProperty("observations");
    expect(calls).toEqual(["bookings"]);
  });

  it("uses a fixed table/query vocabulary and never accepts SQL input", () => {
    const source = readFileSync(resolve(process.cwd(), "app/_ai/operations-tools.ts"), "utf8");
    expect(source).not.toMatch(/execute\s*\(.*sql/i);
    expect(source).toMatch(/getArrivals/);
    expect(source).toMatch(/getBookingMetrics/);
    expect(source).toMatch(/getCabinPerformance/);
    expect(source).toMatch(/getBookingRisks/);
    expect(source).toMatch(/getBookingDetails/);
    expect(source).toMatch(/fetchBoundedRows/);
    expect(source).toMatch(/limit\(OPERATIONS_RESULT_LIMITS\.arrivals \+ 1\)/);
    expect(source).toMatch(/OPERATIONS_MAX_ROWS\.metrics/);
    expect(source).toMatch(/OPERATIONS_MAX_ROWS\.cabinPerformance/);
    expect(source).toMatch(/OPERATIONS_MAX_ROWS\.risks/);
    expect(source).toMatch(/limit\(OPERATIONS_RESULT_LIMITS\.details\)/);
  });

  it("matches the dashboard booking metric basis and uses inclusive range pagination", async () => {
    const builder = chain({
      data: [
        { ...metricRow(2), status: "unconfirmed", totalPrice: 200, extrasPrice: 25, isPaid: true },
        { ...metricRow(20), status: "cancelled", totalPrice: 100, extrasPrice: 10, isPaid: false },
      ],
      error: null,
    }, { paginate: true });
    const client = { from: vi.fn(() => builder) };
    const tools = createOperationsTools({ client, actorId: "actor-1" });
    const output = await tools.getBookingMetrics.execute!({ from: "2026-09-01", to: "2026-09-07" }, {} as never) as any;
    expect(output.metrics).toMatchObject({
      totalBookings: 2,
      totalRevenue: 300,
      extrasRevenue: 35,
      byStatus: { cancelled: 1, unconfirmed: 1 },
      dateBasis: "created_at",
      revenueBasis: "totalPrice",
      includesCancelled: true,
    });
    expect(output.metrics.byStatus).toEqual({
      unconfirmed: 1,
      "checked-in": 0,
      "checked-out": 0,
      cancelled: 1,
    });
    expect(output.sourceIds).toEqual(["booking:2", "booking:20"]);
    expect(output.truncated).toBe(false);
    expect(builder.range).toHaveBeenCalledWith(0, OPERATIONS_RESULT_LIMITS.metrics);
    expect(builder.limit).toHaveBeenCalledWith(OPERATIONS_RESULT_LIMITS.metrics + 1);
    expect(builder.gte).toHaveBeenCalledWith("created_at", "2026-09-01");
  });

  it("fully aggregates 800 metric rows with stable evidence order", async () => {
    const rows = Array.from({ length: 800 }, (_, index) => metricRow(index + 1));
    const builder = chain({ data: rows, error: null }, { paginate: true });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await tools.getBookingMetrics.execute!({ from: "2026-09-01", to: "2026-09-07" }, {} as never) as any;

    expect(output.metrics).toMatchObject({
      totalBookings: 800,
      totalRevenue: 80_000,
      extrasRevenue: 8_000,
      paidBookings: 400,
      unpaidBookings: 400,
    });
    expect(output.truncated).toBe(false);
    expect(output.facts).toContain("Complete result within the server cap.");
    expect(output.sourceIds).toHaveLength(800);
    expect(output.sourceIds.slice(0, 3)).toEqual(["booking:1", "booking:2", "booking:3"]);
    expect(output.sourceIds.at(-1)).toBe("booking:800");
    expect(builder.range.mock.calls).toEqual([[0, 500], [500, 1_000]]);
    expect(builder.order.mock.calls).toEqual([
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("fully aggregates 800 cabin rows across multiple pages", async () => {
    const rows = Array.from({ length: 800 }, (_, index) => cabinRow(index + 1));
    const builder = chain({ data: rows, error: null }, { paginate: true });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await tools.getCabinPerformance.execute!({ from: "2026-09-01", to: "2026-09-07" }, {} as never) as any;

    expect(output.cabins).toEqual([
      expect.objectContaining({ cabinId: 1, bookings: 400, nights: 800, revenue: 40_000 }),
      expect.objectContaining({ cabinId: 2, bookings: 400, nights: 800, revenue: 40_000 }),
    ]);
    expect(output.truncated).toBe(false);
    expect(output.sourceIds).toHaveLength(802);
    expect(output.sourceIds.slice(0, 3)).toEqual(["booking:1", "booking:2", "booking:3"]);
    expect(output.sourceIds.slice(-2)).toEqual(["cabin:1", "cabin:2"]);
    expect(builder.range.mock.calls).toEqual([[0, 500], [500, 1_000]]);
    expect(builder.order.mock.calls).toEqual([
      ["startDate", { ascending: true }],
      ["id", { ascending: true }],
      ["startDate", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("caps more than 2000 rows and marks aggregate output as partial", async () => {
    const rows = Array.from({ length: OPERATIONS_MAX_ROWS.metrics + 1 }, (_, index) => metricRow(index + 1));
    const builder = chain({ data: rows, error: null }, { paginate: true });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await tools.getBookingMetrics.execute!({ from: "2026-09-01", to: "2026-09-07" }, {} as never) as any;

    expect(output.metrics.totalBookings).toBe(OPERATIONS_MAX_ROWS.metrics);
    expect(output.truncated).toBe(true);
    expect(output.facts).toContain(`Partial result: capped at ${OPERATIONS_MAX_ROWS.metrics} bookings.`);
    expect(output.sourceIds).toHaveLength(OPERATIONS_MAX_ROWS.metrics);
    expect(output.sourceIds.at(-1)).toBe("booking:2000");
    expect(output.sourceIds).not.toContain("booking:2001");
    expect(builder.range.mock.calls).toEqual([[0, 500], [500, 1_000], [1_000, 1_500], [1_500, 2_000]]);
  });

  it("caps more than 2000 cabin rows and marks chart output as partial", async () => {
    const rows = Array.from({ length: OPERATIONS_MAX_ROWS.cabinPerformance + 1 }, (_, index) => cabinRow(index + 1));
    const builder = chain({ data: rows, error: null }, { paginate: true });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await tools.getCabinPerformance.execute!({ from: "2026-09-01", to: "2026-09-07" }, {} as never) as any;

    expect(output.cabins).toEqual([
      expect.objectContaining({ cabinId: 1, bookings: 1_000, nights: 2_000, revenue: 100_000 }),
      expect.objectContaining({ cabinId: 2, bookings: 1_000, nights: 2_000, revenue: 100_000 }),
    ]);
    expect(output.truncated).toBe(true);
    expect(output.facts).toContain(`Partial result: capped at ${OPERATIONS_MAX_ROWS.cabinPerformance} bookings.`);
    expect(output.sourceIds).toHaveLength(OPERATIONS_MAX_ROWS.cabinPerformance + 2);
    expect(output.sourceIds).toContain("booking:2000");
    expect(output.sourceIds).not.toContain("booking:2001");
  });

  it.each([
    ["getArrivals", "arrivals"],
    ["getBookingRisks", "risks"],
  ] as const)("orders %s by start date and ID before its bounded query", async (toolName, resultKey) => {
    const resultLimit = toolName === "getArrivals"
      ? OPERATIONS_RESULT_LIMITS.arrivals
      : OPERATIONS_RESULT_LIMITS.risks;
    const builder = chain({
      data: [operationsRow(20), operationsRow(2), operationsRow(10)],
      error: null,
    });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await (tools[toolName] as any).execute(
      { from: "2026-09-01", to: "2026-09-01" },
      {} as never,
    ) as any;

    expect(output[resultKey].map((row: { bookingId: number }) => row.bookingId)).toEqual([2, 10, 20]);
    expect(output.sourceIds).toEqual(["booking:2", "booking:10", "booking:20", "cabin:1"]);
    expect(builder.order.mock.calls).toEqual([
      ["startDate", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(builder.limit).toHaveBeenCalledWith(
      toolName === "getArrivals" ? resultLimit + 1 : 501
    );
  });

  it.each([
    ["getArrivals", "arrivals", 100, false],
    ["getArrivals", "arrivals", 101, true],
    ["getBookingRisks", "risks", 100, false],
    ["getBookingRisks", "risks", 101, true],
  ] as const)("uses limit+1 for exact %s truncation with %i rows", async (toolName, resultKey, rowCount, truncated) => {
    const resultLimit = toolName === "getArrivals"
      ? OPERATIONS_RESULT_LIMITS.arrivals
      : OPERATIONS_RESULT_LIMITS.risks;
    const builder = chain({
      data: Array.from({ length: rowCount }, (_, index) => operationsRow(index + 1)),
      error: null,
    });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await (tools[toolName] as any).execute(
      { from: "2026-09-01", to: "2026-09-01" },
      {} as never,
    ) as any;

    expect(output[resultKey]).toHaveLength(Math.min(rowCount, resultLimit));
    expect(output.truncated).toBe(truncated);
    expect(output[resultKey].at(-1).bookingId).toBe(Math.min(rowCount, resultLimit));
    expect(builder.limit).toHaveBeenCalledWith(
      toolName === "getArrivals" ? resultLimit + 1 : 501
    );
  });

  it("scans beyond safe candidates before selecting the first risk bookings", async () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({
      ...operationsRow(index + 1),
      isPaid: true,
      observations: "",
    }));
    rows[100] = { ...rows[100], isPaid: false };
    rows[549] = { ...rows[549], observations: "Late arrival" };
    const builder = chain({ data: rows, error: null }, { paginate: true });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await tools.getBookingRisks.execute!(
      { from: "2026-09-01", to: "2026-09-01" },
      {} as never,
    ) as any;

    expect(output.risks.map((risk: { bookingId: number }) => risk.bookingId)).toEqual([101, 550]);
    expect(output.truncated).toBe(false);
    expect(output.sourceIds).toEqual(["booking:101", "booking:550", "cabin:1"]);
    expect(output.risks.every((risk: Record<string, unknown>) => !("observations" in risk))).toBe(true);
    expect(builder.range.mock.calls).toEqual([[0, 500], [500, 1_000]]);
    expect(builder.order.mock.calls).toEqual([
      ["startDate", { ascending: true }],
      ["id", { ascending: true }],
      ["startDate", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("marks the risk result partial when the stable candidate scan reaches its hard cap", async () => {
    const rows = Array.from({ length: OPERATIONS_MAX_ROWS.risks + 1 }, (_, index) => ({
      ...operationsRow(index + 1),
      isPaid: true,
      observations: "",
    }));
    rows[OPERATIONS_MAX_ROWS.risks - 1] = {
      ...rows[OPERATIONS_MAX_ROWS.risks - 1],
      isPaid: false,
    };
    const builder = chain({ data: rows, error: null }, { paginate: true });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await tools.getBookingRisks.execute!(
      { from: "2026-09-01", to: "2026-09-01" },
      {} as never,
    ) as any;

    expect(output.risks.map((risk: { bookingId: number }) => risk.bookingId)).toEqual([2_000]);
    expect(output.truncated).toBe(true);
    expect(output.facts).toContain(`Partial result: risk scan capped at ${OPERATIONS_MAX_ROWS.risks} candidate bookings.`);
    expect(output.sourceIds).toEqual(["booking:2000", "cabin:1"]);
    expect(output.sourceIds).not.toContain("booking:2001");
  });

  it("sorts source IDs numerically and keeps details stable across row order", async () => {
    expect(["booking:20", "cabin:2", "booking:2"].sort(compareSourceIds)).toEqual([
      "booking:2",
      "booking:20",
      "cabin:2",
    ]);
    const rows = [
      { id: 20, cabinId: 3, startDate: "2026-09-02", endDate: "2026-09-03", status: "unconfirmed", isPaid: true, numGuests: 1, totalPrice: 20, observations: "", cabins: { name: "B" } },
      { id: 2, cabinId: 1, startDate: "2026-09-01", endDate: "2026-09-02", status: "unconfirmed", isPaid: true, numGuests: 1, totalPrice: 20, observations: "", cabins: { name: "A" } },
    ];
    const builder = chain({ data: rows, error: null });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await tools.getBookingDetails.execute!({ bookingIds: [20, 2] }, {} as never) as any;
    expect(output.bookings.map((booking: { bookingId: number }) => booking.bookingId)).toEqual([2, 20]);
    expect(output.sourceIds).toEqual(["booking:2", "booking:20", "cabin:1", "cabin:3"]);
    expect(builder.limit).toHaveBeenCalledWith(OPERATIONS_RESULT_LIMITS.details);
  });

  it("does not mark booking details partial when all 25 allowed IDs are found", async () => {
    const bookingIds = Array.from({ length: OPERATIONS_RESULT_LIMITS.details }, (_, index) => index + 1);
    const rows = bookingIds.map((id) => ({
      id,
      cabinId: 1,
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      status: "unconfirmed",
      isPaid: true,
      numGuests: 1,
      totalPrice: 100,
      observations: "",
      cabins: { name: "Cabin 001" },
    }));
    const builder = chain({ data: rows, error: null });
    const tools = createOperationsTools({ client: { from: vi.fn(() => builder) }, actorId: "actor-1" });
    const output = await tools.getBookingDetails.execute!({ bookingIds }, {} as never) as any;

    expect(output.bookings).toHaveLength(OPERATIONS_RESULT_LIMITS.details);
    expect(output.truncated).toBe(false);
    expect(output.facts).toContain("25 of 25 requested bookings found.");
    expect(builder.limit).toHaveBeenCalledWith(OPERATIONS_RESULT_LIMITS.details);
  });
});

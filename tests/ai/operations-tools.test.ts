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
import { parseRequestedInternalNoteDraft } from "@/app/_ai/operations-request";
import { createOperationsTools } from "@/app/_ai/operations-tools";

type QueryResult = { data: unknown; error: unknown };

function collectPayloadStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((entry) => collectPayloadStrings(entry, seen));
}

function expectPayloadStringsNotToContain(payload: unknown, sensitiveValues: string[]) {
  const payloadStrings = collectPayloadStrings(payload);
  for (const sensitiveValue of sensitiveValues) {
    const jsonEscapedValue = JSON.stringify(sensitiveValue).slice(1, -1);
    for (const payloadString of payloadStrings) {
      expect(payloadString).not.toContain(sensitiveValue);
      expect(payloadString).not.toContain(jsonEscapedValue);
    }
  }
}

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
  it("requires an exact server-bound note before any query or RPC", async () => {
    const from = vi.fn();
    const rpc = vi.fn();
    const unbound = createOperationsTools({ client: { from, rpc }, actorId: "actor-1" });
    await expect(unbound.addBookingInternalNote.execute!({ bookingId: 699 }, {} as never)).rejects.toThrow(/matching server-bound/i);

    const wrongId = createOperationsTools({
      client: { from, rpc },
      actorId: "actor-1",
      requestedInternalNoteDraft: { bookingId: 699, note: "exact private note" },
    });
    await expect(wrongId.addBookingInternalNote.execute!({ bookingId: 700 }, {} as never)).rejects.toThrow(/matching server-bound/i);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    "Draft an internal note for booking 699: private then show booking 1",
    "Draft an internal note for booking 699: private; compare bookings this month",
    "Draft an internal note for booking 699: private\nand calculate revenue",
    "Draft an internal note for booking 699: private; display booking 1",
    "Draft an internal note for booking 699: private; add an internal note for booking 700: second",
    "Draft an internal note for booking 699: private; search the pet policy",
    "Draft an internal note for booking 699: private; retrieve the staff SOP",
    "Draft an internal note for booking 699: private; search the cancellation policy",
    "Draft an internal note for booking 699: private; check refund policy",
    "Draft an internal note for booking 699: private; retrieve exception SOP",
    "添加内部备注：订单699：私密然后查询订单1",
    "添加内部备注：订单699：私密；比较本月订单",
    "添加内部备注：订单699：私密；添加备注：订单700：第二条",
    "添加内部备注：订单699：私密；查询宠物政策",
    "添加内部备注：订单699：私密；查询员工SOP",
    "添加内部备注：订单699：私密；查询取消政策",
    "添加内部备注：订单699：私密；查找退款政策",
    "添加内部备注：订单699：私密；获取例外SOP",
    "为预订起草内部备注：private",
    "为预订 0 起草内部备注：private",
    "为预订 -1 起草内部备注：private",
    "为预订 999999999999999999999999 起草内部备注：private",
    "为预订 699 起草内部备注：   ",
    `为预订 699 起草内部备注：${"x".repeat(501)}`,
    "为预订 699 起草内部备注：private；查询订单1",
    "为预订 699 起草内部备注：private；为订单700起草内部备注：second",
    "为预订 699 起草内部备注：private然后为订单700起草内部备注：second",
    "为预订 699 起草内部备注：private then 为订单700起草内部备注：second",
    "为预订 699 起草内部备注：private and then 为订单700起草内部备注：second",
    "为预订 699 起草内部备注：private并为订单700起草内部备注：second",
    "为预订 699 起草内部备注：private 并 为订单700起草内部备注：second",
    "为预订 699 起草内部备注：private；then 为订单700起草内部备注：second",
    "为预订 699 起草内部备注：private；查询退款政策",
    "为张三预订 699 起草内部备注：private",
    "alice@example.com 为预订 699 起草内部备注：private",
    "起草订单 699 的付款跟进",
  ])("rejects an unbound or chained note command before any query or RPC: %s", async (text) => {
    const from = vi.fn();
    const rpc = vi.fn();
    const tools = createOperationsTools({
      client: { from, rpc },
      actorId: "actor-1",
      requestedInternalNoteDraft: parseRequestedInternalNoteDraft(text),
    });

    await expect(
      tools.addBookingInternalNote.execute!({ bookingId: 699 }, {} as never),
    ).rejects.toThrow(/matching server-bound/i);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("consumes a bound note synchronously so parallel and later calls cannot duplicate it", async () => {
    const builder = chain({ data: { id: 699 }, error: null });
    const from = vi.fn(() => builder);
    const rpc = vi.fn().mockResolvedValue({
      data: { approval_id: "approval-one-shot", booking_id: 699, note: "exact private note", status: "pending" },
      error: null,
    });
    const tools = createOperationsTools({
      client: { from, rpc },
      actorId: "actor-1",
      requestedInternalNoteDraft: { bookingId: 699, note: "exact private note" },
    });

    const [first, second] = await Promise.allSettled([
      tools.addBookingInternalNote.execute!({ bookingId: 699 }, {} as never),
      tools.addBookingInternalNote.execute!({ bookingId: 699 }, {} as never),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: expect.stringMatching(/already consumed/i) }) });
    await expect(tools.addBookingInternalNote.execute!({ bookingId: 699 }, {} as never)).rejects.toThrow(/already consumed/i);
    expect(from).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not reopen a consumed note when the first booking query fails", async () => {
    const builder = chain({ data: null, error: new Error("query failed") });
    const from = vi.fn(() => builder);
    const rpc = vi.fn();
    const tools = createOperationsTools({
      client: { from, rpc },
      actorId: "actor-1",
      requestedInternalNoteDraft: { bookingId: 699, note: "exact private note" },
    });

    await expect(tools.addBookingInternalNote.execute!({ bookingId: 699 }, {} as never)).rejects.toThrow(/booking not found/i);
    await expect(tools.addBookingInternalNote.execute!({ bookingId: 699 }, {} as never)).rejects.toThrow(/already consumed/i);
    expect(from).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the exact bound note to the approval RPC but only a safe summary to the model", async () => {
    const note = "First line\n  exact internal spacing";
    const builder = chain({ data: { id: 699 }, error: null });
    const rpc = vi.fn().mockResolvedValue({
      data: { approval_id: "approval-secret", booking_id: 699, note, status: "pending" },
      error: null,
    });
    const tools = createOperationsTools({
      client: { from: vi.fn(() => builder), rpc },
      actorId: "actor-1",
      requestedInternalNoteDraft: { bookingId: 699, note },
      now: () => new Date("2026-09-27T00:00:00.000Z"),
    });
    const output = await tools.addBookingInternalNote.execute!({ bookingId: 699 }, {} as never) as any;
    expect(rpc).toHaveBeenCalledWith("create_booking_ai_approval", { p_booking_id: 699, p_note: note });
    expect(output).toMatchObject({ approvalId: "approval-secret", bookingId: 699, note });

    const modelOutput = await tools.addBookingInternalNote.toModelOutput!({
      toolCallId: "tool-1",
      input: { bookingId: 699 },
      output,
    });
    expect(modelOutput).toMatchObject({
      type: "json",
      value: { kind: "internal-note-approval", bookingId: 699, status: "pending" },
    });
    expectPayloadStringsNotToContain(modelOutput, [note, "exact internal spacing", "approval-secret"]);
  });

  it("trims note boundaries before validating and sends an exact 500-character note", async () => {
    const note = "x".repeat(500);
    const requestedInternalNoteDraft = parseRequestedInternalNoteDraft(
      `Draft an internal note for booking 699:   ${note}`,
    );
    expect(requestedInternalNoteDraft).toEqual({ bookingId: 699, note });

    const builder = chain({ data: { id: 699 }, error: null });
    const rpc = vi.fn().mockResolvedValue({
      data: { approval_id: "approval-500", booking_id: 699, note, status: "pending" },
      error: null,
    });
    const tools = createOperationsTools({
      client: { from: vi.fn(() => builder), rpc },
      actorId: "actor-1",
      requestedInternalNoteDraft,
    });
    await tools.addBookingInternalNote.execute!({ bookingId: 699 }, {} as never);
    expect(rpc).toHaveBeenCalledWith("create_booking_ai_approval", {
      p_booking_id: 699,
      p_note: note,
    });
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { operationsCors } from "@/app/_ai/operations-cors";
import { createOperationsInstructions, OPERATIONS_INSTRUCTIONS } from "@/app/_ai/agents/operations-agent";
import {
  MAX_OPERATIONS_AGENT_TEXT_CHARS,
  readOperationsRequest,
  sanitizeOperationsUserText,
} from "@/app/_ai/operations-request";
import { authorizeOperationsStaff } from "@/app/_ai/operations-auth";
import { extractExplicitOperationsDateRange, resolveRelativeOperationsDateRange } from "@/app/_ai/operations-types";

describe("operations BFF security contract", () => {
  const env = { NODE_ENV: "production", AI_ADMIN_ORIGIN: "https://admin.example.com" } as NodeJS.ProcessEnv;

  it("allows only the configured admin origin", () => {
    expect(operationsCors(new Request("https://bff.example.com", { headers: { origin: "https://admin.example.com" } }), env).ok).toBe(true);
    expect(operationsCors(new Request("https://bff.example.com", { headers: { origin: "https://evil.example.com" } }), env).ok).toBe(false);
    expect(operationsCors(new Request("https://bff.example.com", { headers: { origin: "http://admin.example.com" } }), env).ok).toBe(false);
  });

  it("keeps model privacy and mutation boundaries explicit", () => {
    expect(OPERATIONS_INSTRUCTIONS).toMatch(/never request.*guest names.*email/i);
    expect(OPERATIONS_INSTRUCTIONS).toMatch(/only creates a draft approval/i);
    const routeSource = readFileSync(resolve(process.cwd(), "app/api/ai/admin/route.ts"), "utf8");
    expect(routeSource).not.toMatch(/SUPABASE_SECRET|SERVICE_ROLE|NEXT_PUBLIC/);
    expect(routeSource).toMatch(/authorizeOperationsStaff/);
    expect(routeSource).toMatch(/Cache-Control/);
    expect(routeSource).toMatch(/const referenceDate = new Date\(\)/);
    const approvalRoute = readFileSync(resolve(process.cwd(), "app/api/ai/admin/approval/route.ts"), "utf8");
    expect(approvalRoute).toMatch(/x-idempotency-key/);
  });

  it("expands relative date requests from one stable server reference date", () => {
    const instructions = createOperationsInstructions(new Date("2026-09-01T18:30:00.000Z"));
    expect(instructions).toContain("Server reference date: 2026-09-01 (UTC).");
    expect(instructions).toContain('"today" as from=2026-09-01, to=2026-09-01');
    expect(instructions).toContain('"next 7 days" means from=2026-09-01, to=2026-09-07');
    expect(instructions).toMatch(/ask for clarification only when a relative request is ambiguous or exceeds that limit/i);
  });

  it("resolves next 7 days as an inclusive bounded range", () => {
    expect(resolveRelativeOperationsDateRange("Show unpaid arrivals in the next 7 days", new Date("2026-08-25T23:59:59.000Z"))).toEqual({
      from: "2026-08-25",
      to: "2026-08-31",
    });
    expect(resolveRelativeOperationsDateRange("未来 7 天的到店订单", new Date("2026-08-25T12:00:00.000Z"))).toEqual({
      from: "2026-08-25",
      to: "2026-08-31",
    });
    expect(resolveRelativeOperationsDateRange("未来七天有哪些未付款且有特殊需求的到店订单", new Date("2026-08-25T12:00:00.000Z"))).toEqual({
      from: "2026-08-25",
      to: "2026-08-31",
    });
    expect(resolveRelativeOperationsDateRange("next 367 days", new Date("2026-08-25T12:00:00.000Z"))).toBeNull();
  });

  it("resolves English and Chinese today/tomorrow phrases", () => {
    const referenceDate = new Date("2026-08-25T12:00:00.000Z");
    expect(resolveRelativeOperationsDateRange("今天的到店订单", referenceDate)).toEqual({
      from: "2026-08-25",
      to: "2026-08-25",
    });
    expect(resolveRelativeOperationsDateRange("明天的风险", referenceDate)).toEqual({
      from: "2026-08-26",
      to: "2026-08-26",
    });
    expect(resolveRelativeOperationsDateRange("arrivals today", referenceDate)).toEqual({
      from: "2026-08-25",
      to: "2026-08-25",
    });
    expect(resolveRelativeOperationsDateRange("arrivals tomorrow", referenceDate)).toEqual({
      from: "2026-08-26",
      to: "2026-08-26",
    });
  });

  it("validates exactly two explicit dates within the 366-day bound", () => {
    expect(extractExplicitOperationsDateRange("from 2026-08-25 to 2026-08-31")).toEqual({
      from: "2026-08-25",
      to: "2026-08-31",
    });
    expect(extractExplicitOperationsDateRange("查询 2026-08-25 至 2026-08-31 的到店订单")).toEqual({
      from: "2026-08-25",
      to: "2026-08-31",
    });
    expect(extractExplicitOperationsDateRange("2026-01-01 through 2027-01-01")).toEqual({
      from: "2026-01-01",
      to: "2027-01-01",
    });
    expect(extractExplicitOperationsDateRange("2026-01-01 through 2027-01-02")).toBeNull();
    expect(extractExplicitOperationsDateRange("2026-08-31 through 2026-08-25")).toBeNull();
    expect(extractExplicitOperationsDateRange("arrivals on 2026-08-25")).toBeNull();
    expect(extractExplicitOperationsDateRange("2026-02-30 through 2026-08-31")).toBeNull();
    expect(extractExplicitOperationsDateRange("2026-08-25 through 2026-08-31 and 2026-09-01")).toBeNull();
  });

  it("passes the deterministic range hint to the sanitized agent message", async () => {
    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "Show unpaid arrivals in the next 7 days with operational risks" }] }] }),
    }), new Date("2026-08-25T12:00:00.000Z"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.uiMessages[0].parts[0]).toMatchObject({
      text: expect.stringContaining("from=2026-08-25, to=2026-08-31"),
    });
  });

  it("passes a server-validated explicit date range to the agent", async () => {
    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "查询 2026-08-25 至 2026-08-31 的未付款到店订单" }] }] }),
    }), new Date("2026-08-25T12:00:00.000Z"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.uiMessages[0].parts[0]).toMatchObject({
      text: expect.stringContaining("[Server-validated date range: from=2026-08-25, to=2026-08-31"),
    });
  });

  it.each([
    ["Show booking for 张三", "张三"],
    ["Find Alice's booking", "Alice"],
    ["Add note: Call Alice tomorrow", "Alice"],
    ["Draft an internal note Call Alice tomorrow", "Alice"],
    ["Покажи бронирование для Иван Петров", "Иван Петров"],
    ["Show booking for Alice and Bob", "Alice"],
    ["Show booking for Alice and Bob", "Bob"],
    ["Show booking for alice smith", "alice"],
    ["Show booking for alice smith", "smith"],
    ["Show booking for José García", "José García"],
    ["Show booking for 张三和李四", "张三和李四"],
    ["查询张三的预订", "张三"],
    ["Find Alice and Bob booking", "Alice"],
    ["Find Alice and Bob booking", "Bob"],
    ["Find alice smith booking", "alice"],
    ["Find alice smith booking", "smith"],
    ["Show booking for Alice, Bob", "Alice"],
    ["Show booking for Alice, Bob", "Bob"],
    ["Find Alice and Bob's booking", "Alice"],
    ["Find Alice and Bob's booking", "Bob"],
    ["Show booking for 张三, 李四", "张三"],
    ["Show booking for 张三, 李四", "李四"],
    ["备注：Alice, Bob", "Alice"],
    ["备注：Alice, Bob", "Bob"],
    ["покажи бронирование для иван петров", "иван"],
    ["покажи бронирование для иван петров", "петров"],
    ["Afficher la réservation pour jean dupont", "jean"],
    ["Afficher la réservation pour jean dupont", "dupont"],
    ["Show booking for aLiCe SmItH", "aLiCe"],
    ["réservation de jean dupont", "jean"],
    ["réservation de jean dupont", "dupont"],
    ["бронирование ивана петрова", "ивана"],
    ["бронирование ивана петрова", "петрова"],
  ])("removes unlabelled or labelled personal data from model context: %s", (input, pii) => {
    const safe = sanitizeOperationsUserText(input);
    expect(safe).not.toContain(pii);
    if (safe !== "Booking lookup requires a numeric bookingId; guest names are not sent to the AI.") {
      expect(safe).toContain(input.startsWith("备注") ? "备注" : input.startsWith("查询") ? "查询" : input.match(/^\S+/)?.[0] ?? "");
    }
  });

  it.each([
    ["alice smith booking", ["alice", "smith"]],
    ["张三的预订", ["张三"]],
  ])("fails closed for a bare name lookup without requiring a command prefix: %s", (input, privateValues) => {
    const safe = sanitizeOperationsUserText(input);
    for (const privateValue of privateValues) expect(safe).not.toContain(privateValue);
    expect(safe).toContain("[redacted]");
  });

  it.each([
    ["Please retrieve alice smith booking", ["alice", "smith"]],
    ["帮我查张三的预订", ["张三"]],
    ["Show booking for Alice; please retrieve charlie brown booking", ["Alice", "charlie", "brown"]],
    ["Show booking for أحمد محمد", ["أحمد", "محمد"]],
    ["Show booking for 김민수", ["김민수"]],
    ["Show booking for Γιάννης Παπαδόπουλος", ["Γιάννης", "Παπαδόπουλος"]],
    ["Show booking for राहुल शर्मा", ["राहुल", "शर्मा"]],
    ["Show booking for สมชาย ใจดี", ["สมชาย", "ใจดี"]],
    ["Show booking for דוד כהן", ["דוד", "כהן"]],
    ["Show booking for გიორგი მაისურაძე", ["გიორგი", "მაისურაძე"]],
    ["Show booking for Արամ Սարգսյան", ["Արամ", "Սարգսյան"]],
    ["حجز أحمد محمد", ["أحمد", "محمد"]],
    ["김민수 예약 조회", ["김민수", "예약", "조회"]],
    ["κράτηση Γιάννης Παπαδόπουλος", ["Γιάννης", "Παπαδόπουλος"]],
    ["राहुल शर्मा की बुकिंग", ["राहुल", "शर्मा"]],
    ["การจอง สมชาย ใจดี", ["สมชาย", "ใจดี"]],
    ["הזמנה דוד כהן", ["דוד", "כהן"]],
    ["ჯავშანი გიორგი მაისურაძე", ["გიორგი", "მაისურაძე"]],
    ["ամրագրում Արամ Սարգսյան", ["Արամ", "Սարգսյան"]],
    ["Please kindly retrieve أحمد김민수 booking", ["kindly", "أحمد", "김민수"]],
    ["Please retrieve All Day booking", ["All", "Day"]],
    ["Is Alice Smith arriving tomorrow?", ["Alice", "Smith"]],
    ["Show Alice Smith", ["Alice", "Smith"]],
    ["张三明天到店吗", ["张三"]],
    ["Who is Alice Smith?", ["Alice", "Smith"]],
    ["未来七天张三有哪些未付款到店订单", ["张三"]],
  ])("fails closed when a booking lookup contains words outside the safe grammar: %s", (input, privateValues) => {
    const safe = sanitizeOperationsUserText(input);
    expect(safe).toBe("Booking lookup requires a numeric bookingId; guest names are not sent to the AI.");
    for (const privateValue of privateValues) expect(safe).not.toContain(privateValue);
  });

  it("keeps the operational command while redacting a free-form note", () => {
    const safe = sanitizeOperationsUserText("Add note: Call Alice tomorrow");
    expect(safe).toContain("Add note:");
    expect(safe).not.toContain("Alice");
    expect(safe).not.toContain("tomorrow");
  });

  it("keeps an explicit numeric bookingId while redacting the note body", () => {
    const safe = sanitizeOperationsUserText("Draft an internal note for booking 123: Call Alice tomorrow");
    expect(safe).toContain("bookingId=123");
    expect(safe).not.toContain("Alice");
    expect(safe).not.toContain("tomorrow");

    const longId = sanitizeOperationsUserText("Draft an internal note bookingId=1234567890: Email Alice");
    expect(longId).toContain("bookingId=1234567890");
    expect(longId).not.toContain("Alice");
  });

  it.each([
    ["Draft an internal note for booking 123:\nCall Alice tomorrow", "123", ["Call", "Alice", "tomorrow"]],
    ["Add an internal note for booking 456:\nFirst line\nEmail José García", "456", ["First line", "Email", "José García"]],
    ["添加内部备注：booking 789\n明天联系张三", "789", ["明天", "联系张三"]],
    ["添加内部备注：订单789\n明天联系张三，电话 +1 (555) 123-4567", "789", ["明天", "联系张三", "555", "123-4567"]],
    ["创建备注：预订654\nEmail alice@example.com\nCall Alice", "654", ["alice@example.com", "Call Alice"]],
    ["草拟备注 bookingId=987：\nCall Иван Петров", "987", ["Call", "Иван Петров"]],
  ])("redacts a multiline note body while preserving its numeric booking ID: %s", (input, bookingId, privateValues) => {
    const safe = sanitizeOperationsUserText(input);
    expect(safe).toContain(`bookingId=${bookingId}`);
    expect(safe).toContain("[redacted]");
    for (const privateValue of privateValues) expect(safe).not.toContain(privateValue);
  });

  it("redacts contact fields and all free-form note content", () => {
    const safe = sanitizeOperationsUserText(
      "Find arrivals for email: alice@example.com, phone: +1 (555) 123-4567; Add note: Call Alice tomorrow"
    );
    expect(safe).not.toMatch(/alice@example\.com|555|Alice|tomorrow/i);
    expect(safe).toContain("Find arrivals");
    expect(safe).toContain("Add note:");
  });

  it("passes only sanitized user text to the agent input for multilingual adversarial prompts", async () => {
    const examples: Array<[string, string[]]> = [
      ["Show booking for 张三", ["张三"]],
      ["查询张三的预订", ["张三"]],
      ["Find Alice's booking", ["Alice"]],
      ["Show booking for alice smith", ["alice", "smith"]],
      ["Show booking for aLiCe SmItH", ["aLiCe", "SmItH"]],
      ["alice smith booking", ["alice", "smith"]],
      ["张三的预订", ["张三"]],
      ["Afficher la réservation pour jean dupont", ["jean", "dupont"]],
      ["réservation de jean dupont", ["jean", "dupont"]],
      ["покажи бронирование для иван петров", ["иван", "петров"]],
      ["бронирование ивана петрова", ["ивана", "петрова"]],
      ["Add note: Call Alice tomorrow", ["Alice", "tomorrow"]],
      ["Draft an internal note for booking 123:\nCall Alice tomorrow", ["Alice", "tomorrow"]],
    ];
    for (const [text, pii] of examples) {
      const result = await readOperationsRequest(new Request("https://bff.example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }] }),
      }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        const modelText = result.uiMessages[0].parts[0].type === "text"
          ? result.uiMessages[0].parts[0].text
          : "";
        for (const value of pii) expect(modelText).not.toContain(value);
      }
    }
  });

  it.each([
    ["Please retrieve alice smith booking", ["alice", "smith"]],
    ["帮我查张三的预订", ["张三"]],
    ["Show booking for أحمد محمد", ["أحمد", "محمد"]],
    ["Show booking for 김민수", ["김민수"]],
    ["Show booking for Γιάννης Παπαδόπουλος", ["Γιάννης", "Παπαδόπουλος"]],
    ["Show booking for राहुल शर्मा", ["राहुल", "शर्मा"]],
    ["Show booking for สมชาย ใจดี", ["สมชาย", "ใจดี"]],
    ["Show booking for דוד כהן", ["דוד", "כהן"]],
    ["Show booking for გიორგი მაისურაძე", ["გიორგი", "მაისურაძე"]],
    ["Show booking for Արամ Սարգսյան", ["Արամ", "Սարգսյան"]],
    ["حجز أحمد محمد", ["أحمد", "محمد"]],
    ["김민수 예약 조회", ["김민수", "예약", "조회"]],
    ["κράτηση Γιάννης Παπαδόπουλος", ["Γιάννης", "Παπαδόπουλος"]],
    ["राहुल शर्मा की बुकिंग", ["राहुल", "शर्मा"]],
    ["การจอง สมชาย ใจดี", ["สมชาย", "ใจดี"]],
    ["הזמנה דוד כהן", ["דוד", "כהן"]],
    ["ჯავშანი გიორგი მაისურაძე", ["გიორგი", "მაისურაძე"]],
    ["ամրագրում Արամ Սարգսյան", ["Արամ", "Սարգսյան"]],
    ["Please kindly retrieve أحمد김민수 booking", ["kindly", "أحمد", "김민수"]],
    ["Please retrieve All Day booking", ["All", "Day"]],
    ["Is Alice Smith arriving tomorrow?", ["Alice", "Smith"]],
    ["Show Alice Smith", ["Alice", "Smith"]],
    ["张三明天到店吗", ["张三"]],
    ["Who is Alice Smith?", ["Alice", "Smith"]],
    ["未来七天张三有哪些未付款到店订单", ["张三"]],
  ])("passes an exact fixed fallback to the agent for an unsafe lookup: %s", async (text, privateValues) => {
    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }] }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      expect(result.uiMessages[0].parts[0].text).toBe(
        "Booking lookup requires a numeric bookingId; guest names are not sent to the AI."
      );
      for (const privateValue of privateValues) {
        expect(result.uiMessages[0].parts[0].text).not.toContain(privateValue);
      }
    }
  });

  it.each([
    ["Which arrivals for Alice Smith need special attention tomorrow?", ["Alice", "Smith"]],
    ["未来七天张三有哪些未付款到店订单", ["张三"]],
  ])("never leaks a name inserted into an otherwise safe operations question: %s", async (text, privateValues) => {
    const safe = sanitizeOperationsUserText(text);
    for (const privateValue of privateValues) expect(safe).not.toContain(privateValue);

    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }] }),
    }), new Date("2026-08-25T12:00:00.000Z"));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      for (const privateValue of privateValues) {
        expect(result.uiMessages[0].parts[0].text).not.toContain(privateValue);
      }
    }
  });

  it.each([
    ["Show booking 123", "Show booking 123"],
    ["Show booking metrics and revenue", "Show booking metrics and revenue"],
    ["Show cabin performance for bookings", "Show cabin performance for bookings"],
    ["查询未付款的预订", "查询未付款的预订"],
    ["Show status for booking 123", "Show status for booking 123"],
    ["Show risks for booking 123", "Show risks for booking 123"],
    ["Show metrics for booking 123", "Show metrics for booking 123"],
    ["Show revenue for booking 123", "Show revenue for booking 123"],
    ["Show payment for booking 123", "Show payment for booking 123"],
    ["Show payments for booking 123", "Show payments for booking 123"],
    ["Show details for booking 123", "Show details for booking 123"],
    ["Show details of booking 123", "Show details of booking 123"],
    ["Show summary for booking 123", "Show summary for booking 123"],
    ["Show report for booking 123", "Show report for booking 123"],
    ["Show count for booking 123", "Show count for booking 123"],
    ["Show arrivals for booking 123", "Show arrivals for booking 123"],
    ["Show cabin performance for booking 123", "Show cabin performance for booking 123"],
  ])("passes an exact safe lookup to the agent unchanged: %s", async (text, expected) => {
    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }] }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      expect(result.uiMessages[0].parts[0].text).toBe(expected);
    }
  });

  it.each([
    "Show status for booking 123",
    "Show risks for booking 123",
    "Show metrics for booking 123",
    "Show revenue for booking 123",
    "Show payment for booking 123",
    "Show payments for booking 123",
    "Show details for booking 123",
    "Show details of booking 123",
    "Show summary for booking 123",
    "Show report for booking 123",
    "Show count for booking 123",
    "Show arrivals for booking 123",
    "Show cabin performance for booking 123",
  ])("keeps an exact numeric-booking operational intent: %s", (input) => {
    expect(sanitizeOperationsUserText(input)).toBe(input);
  });

  it.each([
    "Show arrivals tomorrow",
    "Who is arriving tomorrow?",
    "查询明天到店的预订",
    "未来七天有哪些未付款且有特殊需求的到店订单",
    "Show unpaid arrivals with special requests in the next 7 days",
    "Which unpaid arrivals need special attention in the next 7 days?",
    "How many arrivals are there tomorrow?",
  ])("keeps a name-free operations question in the local grammar: %s", (input) => {
    expect(sanitizeOperationsUserText(input)).toBe(input);
  });

  it.each([
    ["Show Alice for booking 123", ["Alice"]],
    ["Please retrieve All Day booking", ["All", "Day"]],
  ])("does not leak a name-shaped candidate next to safe booking syntax: %s", (input, privateValues) => {
    const safe = sanitizeOperationsUserText(input);
    for (const privateValue of privateValues) expect(safe).not.toContain(privateValue);
    expect(safe === "Booking lookup requires a numeric bookingId; guest names are not sent to the AI." || safe.includes("[redacted]")).toBe(true);
  });

  it.each([
    ["Show guest active booking", "Show guest [redacted] booking", ["active"]],
    ["Show booking for revenue", "Show booking for [redacted]", ["revenue"]],
    ["Show booking for all", "Show booking for [redacted]", ["all"]],
    ["Show CUSTOMER Active Revenue booking", "Show CUSTOMER [redacted] booking", ["Active", "Revenue"]],
    ["Show name All Day booking", "Show name [redacted] booking", ["All", "Day"]],
  ])("unconditionally redacts an explicit guest-name slot: %s", async (input, expected, privateValues) => {
    expect(sanitizeOperationsUserText(input)).toBe(expected);

    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: input }] }] }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      expect(result.uiMessages[0].parts[0].text).toBe(expected);
      for (const privateValue of privateValues) {
        expect(result.uiMessages[0].parts[0].text).not.toContain(privateValue);
      }
    }
  });

  it("passes exact safe relative and ISO-date lookup syntax plus deterministic hints", async () => {
    const referenceDate = new Date("2026-08-25T12:00:00.000Z");
    const examples = [
      [
        "Show unpaid upcoming booking next 7 days",
        "Show unpaid upcoming booking next 7 days\n[Server-resolved date range: from=2026-08-25, to=2026-08-31 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Show metrics for bookings next 7 days",
        "Show metrics for bookings next 7 days\n[Server-resolved date range: from=2026-08-25, to=2026-08-31 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Show revenue for bookings next 7 days",
        "Show revenue for bookings next 7 days\n[Server-resolved date range: from=2026-08-25, to=2026-08-31 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Show total revenue for bookings next 7 days",
        "Show total revenue for bookings next 7 days\n[Server-resolved date range: from=2026-08-25, to=2026-08-31 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Show today’s bookings",
        "Show today’s bookings\n[Server-resolved date range: from=2026-08-25, to=2026-08-25 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Show tomorrow’s bookings",
        "Show tomorrow’s bookings\n[Server-resolved date range: from=2026-08-26, to=2026-08-26 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "查询今天的预订",
        "查询今天的预订\n[Server-resolved date range: from=2026-08-25, to=2026-08-25 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "查询明天的预订",
        "查询明天的预订\n[Server-resolved date range: from=2026-08-26, to=2026-08-26 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Show bookings from 2026-08-25 to 2026-08-31",
        "Show bookings from 2026-08-25 to 2026-08-31\n[Server-validated date range: from=2026-08-25, to=2026-08-31 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Show arrivals tomorrow",
        "Show arrivals tomorrow\n[Server-resolved date range: from=2026-08-26, to=2026-08-26 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Who is arriving tomorrow?",
        "Who is arriving tomorrow?\n[Server-resolved date range: from=2026-08-26, to=2026-08-26 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "查询明天到店的预订",
        "查询明天到店的预订\n[Server-resolved date range: from=2026-08-26, to=2026-08-26 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "未来七天有哪些未付款且有特殊需求的到店订单",
        "未来七天有哪些未付款且有特殊需求的到店订单\n[Server-resolved date range: from=2026-08-25, to=2026-08-31 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Show unpaid arrivals with special requests in the next 7 days",
        "Show unpaid arrivals with special requests in the next 7 days\n[Server-resolved date range: from=2026-08-25, to=2026-08-31 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "Which unpaid arrivals need special attention in the next 7 days?",
        "Which unpaid arrivals need special attention in the next 7 days?\n[Server-resolved date range: from=2026-08-25, to=2026-08-31 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
      [
        "How many arrivals are there tomorrow?",
        "How many arrivals are there tomorrow?\n[Server-resolved date range: from=2026-08-26, to=2026-08-26 (inclusive). Use these exact bounded dates without asking the employee to restate them.]",
      ],
    ];
    for (const [text, expected] of examples) {
      const result = await readOperationsRequest(new Request("https://bff.example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }] }),
      }), referenceDate);
      expect(result.ok).toBe(true);
      if (result.ok && result.uiMessages[0].parts[0].type === "text") {
        expect(result.uiMessages[0].parts[0].text).toBe(expected);
      }
    }
  });

  it("preserves numeric booking IDs and deterministic date hints without preserving names", async () => {
    const safe = sanitizeOperationsUserText("Show booking 123 for alice smith next 7 days");
    expect(safe).toContain("123");
    expect(safe).toContain("next 7 days");
    expect(safe).not.toMatch(/alice|smith/i);

    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "Show booking 123 for alice smith next 7 days" }] }] }),
    }), new Date("2026-08-25T12:00:00.000Z"));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      expect(result.uiMessages[0].parts[0].text).toContain("123");
      expect(result.uiMessages[0].parts[0].text).toContain("from=2026-08-25, to=2026-08-31");
      expect(result.uiMessages[0].parts[0].text).not.toMatch(/alice|smith/i);
    }
  });

  it("tokenizes a long numeric booking ID before phone redaction and still removes real phone numbers", async () => {
    const safeBooking = sanitizeOperationsUserText("Show booking 1234567890");
    expect(safeBooking).toBe("Show booking 1234567890");

    const safePhone = sanitizeOperationsUserText("Find arrivals; phone: +1 (555) 123-4567");
    expect(safePhone).not.toMatch(/555|123-4567/);
    expect(safePhone).toContain("phone: [redacted]");

    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "Show booking 1234567890" }] }] }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      expect(result.uiMessages[0].parts[0].text).toContain("booking 1234567890");
    }
  });

  it("fails closed instead of slicing a restored ISO token past the 2000-character bound", async () => {
    const repeatedIso = "Show arrivals from 2026-08-25 to 2026-08-31 and ".repeat(80).trim();
    const safe = sanitizeOperationsUserText(repeatedIso);
    expect(safe).toBe("Booking lookup requires a numeric bookingId; guest names are not sent to the AI.");
    expect(safe).not.toMatch(/2026-08-|__(?:BOOKING_ID|OPERATIONS_DATE|OPERATIONS_RELATIVE_DATE)_/u);

    const boundedRequestIso = "Show arrivals from 2026-08-25 to 2026-08-31 and ".repeat(35).trim();
    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: boundedRequestIso }] }] }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      expect(result.uiMessages[0].parts[0].text.length).toBeLessThanOrEqual(MAX_OPERATIONS_AGENT_TEXT_CHARS);
      expect(result.uiMessages[0].parts[0].text).not.toMatch(/__(?:BOOKING_ID|OPERATIONS_DATE|OPERATIONS_RELATIVE_DATE)_/u);
    }
  });

  it.each([397, 398])("never turns an overlong booking ID into a different valid ID at repeat %i", async (repeatCount) => {
    const input = `${"Show ".repeat(repeatCount)}booking 1234567890`.trim();
    expect(input.length).toBeGreaterThan(MAX_OPERATIONS_AGENT_TEXT_CHARS);
    expect(sanitizeOperationsUserText(input)).toBe(
      "Booking lookup requires a numeric bookingId; guest names are not sent to the AI."
    );

    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: input }] }] }),
    }));
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(JSON.stringify(result)).not.toMatch(/1234567|booking 12/u);
  });

  it.each([1_999, 2_000])("preserves a complete booking ID at the legal %i-character boundary", async (length) => {
    const suffix = "booking 1234567890";
    const availablePrefix = length - suffix.length;
    const input = `${"Show ".repeat(Math.floor(availablePrefix / 5))}${" ".repeat(availablePrefix % 5)}${suffix}`;
    expect(input).toHaveLength(length);
    expect(sanitizeOperationsUserText(input)).toBe(input);

    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: input }] }] }),
    }));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      expect(result.uiMessages[0].parts[0].text).toBe(input);
      expect(result.uiMessages[0].parts[0].text).toContain("booking 1234567890");
    }
  });

  it("keeps a complete deterministic hint while bounding a long relative-date request", async () => {
    const repeatedRelative = "Show arrivals tomorrow and ".repeat(70).trim();
    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: repeatedRelative }] }] }),
    }), new Date("2026-08-25T12:00:00.000Z"));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      const modelText = result.uiMessages[0].parts[0].text;
      expect(modelText.length).toBeLessThanOrEqual(MAX_OPERATIONS_AGENT_TEXT_CHARS);
      expect(modelText).toContain("[Server-resolved date range: from=2026-08-26, to=2026-08-26 (inclusive).");
      expect(modelText.endsWith("without asking the employee to restate them.]")).toBe(true);
      expect(modelText).not.toMatch(/__(?:BOOKING_ID|OPERATIONS_DATE|OPERATIONS_RELATIVE_DATE)_/u);
    }
  });

  it("never slices a booking ID while making room for a complete relative-date hint", async () => {
    const text = `${"Show arrivals tomorrow and ".repeat(68)}Show booking 1234567890 tomorrow`;
    expect(text.length).toBeLessThanOrEqual(MAX_OPERATIONS_AGENT_TEXT_CHARS);
    const result = await readOperationsRequest(new Request("https://bff.example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }] }),
    }), new Date("2026-08-25T12:00:00.000Z"));
    expect(result.ok).toBe(true);
    if (result.ok && result.uiMessages[0].parts[0].type === "text") {
      const modelText = result.uiMessages[0].parts[0].text;
      expect(modelText.length).toBeLessThanOrEqual(MAX_OPERATIONS_AGENT_TEXT_CHARS);
      const emittedBookingIds = [...modelText.matchAll(/\bbooking\s+(\d+)/giu)].map((match) => match[1]);
      expect(emittedBookingIds.every((bookingId) => bookingId === "1234567890")).toBe(true);
      expect(modelText).not.toMatch(/__(?:BOOKING_ID|OPERATIONS_DATE|OPERATIONS_RELATIVE_DATE)_/u);
      expect(modelText.endsWith("without asking the employee to restate them.]")).toBe(true);
    }
  });

  it("does not corrupt ordinary operational filters or date phrases while redacting bare names", () => {
    expect(sanitizeOperationsUserText("unpaid upcoming booking next 7 days")).toBe("unpaid upcoming booking next 7 days");
    expect(sanitizeOperationsUserText("Show unpaid upcoming booking next 7 days")).toBe("Show unpaid upcoming booking next 7 days");
    expect(sanitizeOperationsUserText("Show booking metrics and revenue next 7 days")).toBe("Show booking metrics and revenue next 7 days");
    expect(sanitizeOperationsUserText("Show metrics for bookings next 7 days")).toBe("Show metrics for bookings next 7 days");
    expect(sanitizeOperationsUserText("Show revenue for bookings next 7 days")).toBe("Show revenue for bookings next 7 days");
    expect(sanitizeOperationsUserText("Show total revenue for bookings next 7 days")).toBe("Show total revenue for bookings next 7 days");
    expect(sanitizeOperationsUserText("Show today’s bookings")).toBe("Show today’s bookings");
    expect(sanitizeOperationsUserText("Show tomorrow’s bookings")).toBe("Show tomorrow’s bookings");
    expect(sanitizeOperationsUserText("Show cabin performance for bookings next 7 days")).toBe("Show cabin performance for bookings next 7 days");
    expect(sanitizeOperationsUserText("查询未付款的预订")).toBe("查询未付款的预订");
    expect(sanitizeOperationsUserText("查询今天的预订")).toBe("查询今天的预订");
    expect(sanitizeOperationsUserText("查询明天的预订")).toBe("查询明天的预订");
    expect(sanitizeOperationsUserText("查询未来七天的预订收入统计")).toBe("查询未来七天的预订收入统计");
    expect(sanitizeOperationsUserText("Show alice smith booking")).toBe("Show [redacted] booking");
    expect(sanitizeOperationsUserText("查询张三的预订")).toBe("查询[redacted]的预订");
    expect(sanitizeOperationsUserText("未来七天的预订")).toBe("未来七天的预订");
    expect(sanitizeOperationsUserText("Show arrivals from 2026-08-25 to 2026-08-31")).toBe("Show arrivals from 2026-08-25 to 2026-08-31");
  });

  it("keeps the operational intent while redacting labelled sensitive values", () => {
    const safe = sanitizeOperationsUserText(
      "Find arrivals for 姓名：张三, email: guest@example.com, phone: +1 (555) 123-4567; observations: peanut allergy"
    );
    expect(safe).not.toContain("张三");
    expect(safe).not.toContain("guest@example.com");
    expect(safe).not.toContain("555");
    expect(safe).not.toContain("peanut allergy");
    expect(safe).toContain("Find arrivals");
    expect(safe).toContain("email:");
    expect(safe).toContain("observations:");
  });

  it("rejects guests and unauthenticated requests before any agent is created", async () => {
    const noToken = await authorizeOperationsStaff(new Request("https://bff.example.com"), {
      env: { NODE_ENV: "test", SUPABASE_URL: "https://supabase.example", SUPABASE_PUBLISHABLE_KEY: "publishable" },
    });
    expect(noToken).toMatchObject({ ok: false, status: 401 });

    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "guest", app_metadata: { role: "guest" } } }, error: null });
    const guest = await authorizeOperationsStaff(new Request("https://bff.example.com", { headers: { authorization: "Bearer guest-token" } }), {
      env: { NODE_ENV: "test", SUPABASE_URL: "https://supabase.example", SUPABASE_PUBLISHABLE_KEY: "publishable" },
      createClient: vi.fn(() => ({ auth: { getUser } })) as never,
    });
    expect(guest).toMatchObject({ ok: false, status: 403 });
    expect(getUser).toHaveBeenCalledWith("guest-token");
  });
});

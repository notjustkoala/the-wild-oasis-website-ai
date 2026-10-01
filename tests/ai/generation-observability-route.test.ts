import { POST as concierge } from "@/app/api/ai/concierge/route";
import { POST as operations } from "@/app/api/ai/admin/route";
import { createBookingInsightRouteHandlers } from "@/app/_ai/booking-insight-route";
import { CONCIERGE_GENERATE_TIMEOUT, CONCIERGE_TIMEOUT } from "@/app/_ai/concierge-stream";
import { safeGenerationErrorDiagnostic } from "@/app/_ai/observability/error-diagnostic";
const mocks = vi.hoisted(() => ({ persist: vi.fn(), limit: vi.fn(), authorize: vi.fn(), stream: vi.fn(), generate: vi.fn(), consoleError: vi.fn(), observer: null as any, agentOptions: null as any }));
vi.mock("@/app/_ai/observability/run", async original => { const actual = await original<typeof import("@/app/_ai/observability/run")>(); return { ...actual, createRunObserver: (options: any) => actual.createRunObserver({ ...options, persist: mocks.persist }) }; });
vi.mock("@/app/_ai/observability/access", async original => ({ ...await original<typeof import("@/app/_ai/observability/access")>(), enforceRateLimit: mocks.limit }));
vi.mock("@/app/_ai/providers/concierge-model", async original => ({ ...await original<typeof import("@/app/_ai/providers/concierge-model")>(), getConciergeProviderConfigurationError: () => null, resolveConciergeProviderConfiguration: () => ({ modelId: "fixture-model" }) }));
vi.mock("@/app/_ai/operations-auth", () => ({ authorizeOperationsStaff: mocks.authorize }));
vi.mock("@/app/_ai/agents/concierge-agent", () => ({ CONCIERGE_INSTRUCTIONS: "fixture", createConciergeAgent: (options: any) => { mocks.observer = options.observer; return {}; } }));
vi.mock("@/app/_ai/agents/operations-agent", () => ({ OPERATIONS_INSTRUCTIONS: "fixture", createOperationsAgent: (options: any) => { mocks.observer = options.observer; mocks.agentOptions = options; return { tools: {}, generate: mocks.generate }; } }));
vi.mock("ai", async original => ({ ...await original<typeof import("ai")>(), createAgentUIStreamResponse: mocks.stream }));
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
function request(surface: string, options: { origin?: string; signal?: AbortSignal; text?: string; accept?: string; authorization?: string } = {}) {
  return new Request(`http://localhost/api/ai/${surface}`, { method: "POST", signal: options.signal, headers: { "content-type": "application/json", accept: options.accept ?? "application/json", ...(options.origin ? { origin: options.origin } : {}), ...(options.authorization ? { authorization: options.authorization } : {}) }, body: JSON.stringify(surface === "insight" ? {} : { messages: [{ id: "fixture", role: "user", parts: [{ type: "text", text: options.text ?? "Show arrivals" }] }] }) });
}
describe("generation routes preserve trace and failure semantics", () => {
  let restoreConsoleError: () => void = () => undefined;
  beforeEach(() => { vi.stubEnv("AI_OBSERVABILITY_SECRET", "fixture-secret"); mocks.consoleError.mockClear(); const consoleError = vi.spyOn(console, "error").mockImplementation(mocks.consoleError); restoreConsoleError = () => consoleError.mockRestore(); mocks.agentOptions = null; mocks.persist.mockResolvedValue(true); mocks.limit.mockResolvedValue({ ok: true }); mocks.authorize.mockResolvedValue({ ok: true, client: {}, user: { id: "synthetic" } }); mocks.stream.mockRejectedValue(new Error("private@example.invalid")); mocks.generate.mockRejectedValue(new Error("private@example.invalid")); });
  afterEach(() => { restoreConsoleError(); vi.unstubAllEnvs(); });
  for (const [surface, post] of [["concierge", concierge], ["admin", operations]] as const) {
    it(`${surface}: rejects cross-origin with trace and no receipt`, async () => { const response = await post(request(surface, { origin: "https://evil.invalid" })); expect(response.status).toBe(403); expect(response.headers.get("X-AI-Trace-Id")).toBeTruthy(); expect(response.headers.has("X-AI-Feedback-Token")).toBe(false); expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ status: "denied" })); });
    it(`${surface}: rate limits before model invocation`, async () => { mocks.limit.mockResolvedValue({ ok: false, status: 429, retryAfter: 37 }); const response = await post(request(surface)); expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("37"); expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ status: "rate-limited" })); expect(mocks.stream).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled(); });
    it(`${surface}: contains provider failure and exposes safe trace`, async () => { const response = await post(request(surface)); expect(response.status).toBe(503); const body = await response.text(); expect(body).not.toContain("private@"); expect(body).toContain(response.headers.get("X-AI-Trace-Id")!); expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error_code: "provider-unavailable" })); });
    it(`${surface}: records timeout without a complete token total`, async () => { const error = new Error("private"); error.name = "TimeoutError"; mocks.stream.mockRejectedValue(error); mocks.generate.mockRejectedValue(error); const response = await post(request(surface)); expect(response.status).toBe(504); expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ status: "timeout", input_tokens: null, output_tokens: null })); });
    it(`${surface}: records client cancellation exactly once`, async () => { const control = new AbortController(); control.abort(); await post(request(surface, { signal: control.signal })); expect(mocks.persist).toHaveBeenCalledTimes(1); expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" })); });
  }
  it("contains authorization infrastructure failure", async () => { mocks.authorize.mockRejectedValue(new Error("private")); const response = await operations(request("admin")); expect(response.status).toBe(503); expect(mocks.persist).toHaveBeenCalledTimes(1); });
  it("operations retains tool-error status even when the model produces final text", async () => {
    mocks.generate.mockImplementation(async () => { mocks.observer.step({ toolCalls: [{ toolName: "getArrivals" }], content: [{ type: "tool-error" }], usage: { inputTokens: 5, outputTokens: 1 } }); return { text: "Unable to retrieve arrivals.", finishReason: "stop", steps: [] }; });
    expect((await operations(request("admin"))).status).toBe(200); expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error_code: "tool-error", tool_error_count: 1 }));
  });
  it("operations removes only streaming deadlines from generate timeout", async () => {
    mocks.generate.mockResolvedValue({ text: "Done.", finishReason: "stop", steps: [] });
    expect((await operations(request("admin"))).status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      timeout: CONCIERGE_GENERATE_TIMEOUT,
      abortSignal: expect.any(AbortSignal),
    }));
    expect(mocks.generate.mock.calls[0][0].timeout).toEqual({
      totalMs: CONCIERGE_TIMEOUT.totalMs,
      stepMs: 80_000,
      toolMs: CONCIERGE_TIMEOUT.toolMs,
    });
    expect(CONCIERGE_GENERATE_TIMEOUT.stepMs).toBeLessThan(CONCIERGE_GENERATE_TIMEOUT.totalMs);
    expect(mocks.generate.mock.calls[0][0].timeout).not.toHaveProperty("firstChunkMs");
    expect(mocks.generate.mock.calls[0][0].timeout).not.toHaveProperty("chunkMs");

    mocks.stream.mockResolvedValue(new Response("stream"));
    expect((await operations(request("admin", { accept: "text/event-stream" }))).status).toBe(200);
    expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({
      timeout: CONCIERGE_TIMEOUT,
      abortSignal: expect.any(AbortSignal),
    }));
    expect(CONCIERGE_TIMEOUT).toEqual({
      totalMs: 90_000,
      stepMs: 60_000,
      firstChunkMs: 60_000,
      chunkMs: 30_000,
      toolMs: 20_000,
    });
  });
  it("operations logs only allow-listed diagnostics for nested provider failures", async () => {
    const sensitiveQuestion = "Show private@example.invalid and secret guest details";
    mocks.generate.mockRejectedValue({
      name: "AI_RetryError",
      message: `failed for ${sensitiveQuestion}`,
      lastError: {
        name: "AI_APICallError",
        statusCode: 503,
        isRetryable: true,
        code: "PRIVATE_PROVIDER_CODE",
        responseBody: "api-key-private-body",
      },
    });

    const response = await operations(request("admin", {
      text: sensitiveQuestion,
      authorization: "Bearer private-authorization-token",
    }));
    expect(response.status).toBe(503);
    expect(mocks.consoleError).toHaveBeenCalledTimes(1);
    const diagnostic = JSON.parse(String(mocks.consoleError.mock.calls[0][0])) as Record<string, unknown>;
    expect(diagnostic).toMatchObject({
      level: "error",
      event: "operations-generation-failed",
      route: "/api/ai/admin",
      surface: "operations",
      traceId: response.headers.get("X-AI-Trace-Id"),
      mode: "generate",
      errorName: "AI_RetryError",
      code: "provider-http",
      status: 503,
      retryable: true,
      durationMs: expect.any(Number),
    });
    expect(Object.keys(diagnostic).sort()).toEqual([
      "code",
      "durationMs",
      "errorName",
      "event",
      "level",
      "mode",
      "retryable",
      "route",
      "status",
      "surface",
      "traceId",
    ]);
    expectPayloadStringsNotToContain(diagnostic, [
      sensitiveQuestion,
      "private@example.invalid",
      "private-authorization-token",
      "PRIVATE_PROVIDER_CODE",
      "api-key-private-body",
    ]);
    expect(await response.json()).toMatchObject({
      error: "The operations copilot is temporarily unavailable. Continue with Bookings or Dashboard.",
      traceId: diagnostic.traceId,
    });
  });
  it("operations contains diagnostic failures and still returns the safe response", async () => {
    const hostileError = new Proxy({}, {
      get() {
        throw new Error("private proxy trap");
      },
    });
    mocks.generate.mockRejectedValue(hostileError);
    mocks.consoleError.mockImplementationOnce(() => {
      throw new Error("private logging failure");
    });

    const response = await operations(request("admin"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "The operations copilot is temporarily unavailable. Continue with Bookings or Dashboard.",
      traceId: expect.any(String),
    });
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      error_code: "provider-unavailable",
    }));
  });
  it("operations binds an exact note only in agent options and never persists its text", async () => {
    const exactNote = "F06-R5 验收——请在入住前跟进付款。";
    const proposal = {
      kind: "internal-note-approval",
      approvalId: "approval-json-route",
      bookingId: 699,
      note: exactNote,
      status: "pending",
      sourceIds: ["approval:approval-json-route", "booking:699"],
      facts: ["Employee approval is required before writing."],
      truncated: false,
    };
    mocks.generate.mockResolvedValue({
      text: "Approval required.",
      finishReason: "stop",
      steps: [{
        stepNumber: 0,
        text: "",
        toolCalls: [{ toolName: "addBookingInternalNote", input: { bookingId: 699 } }],
        toolResults: [{ toolName: "addBookingInternalNote", output: proposal }],
      }],
    });
    const response = await operations(request("admin", {
      text: `为预订 699 起草内部备注：${exactNote}`,
    }));
    expect(response.status).toBe(200);
    expect(mocks.agentOptions.requestedInternalNoteDraft).toEqual({ bookingId: 699, note: exactNote });
    expectPayloadStringsNotToContain(mocks.generate.mock.calls, [exactNote, "F06-R5", "验收", "跟进付款"]);
    expect(await response.json()).toMatchObject({
      steps: [{
        toolCalls: [{ toolName: "addBookingInternalNote", input: { bookingId: 699 } }],
        toolResults: [{ toolName: "addBookingInternalNote", output: proposal }],
      }],
    });
    expectPayloadStringsNotToContain(mocks.persist.mock.calls, [exactNote, "F06-R5", "验收", "跟进付款"]);
  });
  it("booking insight rejects early paths with trace, while cache hits have no generation receipt", async () => {
    const analyze = vi.fn().mockResolvedValue({ state: "fresh", insight: null });
    const handlers = createBookingInsightRouteHandlers({ env: { NODE_ENV: "test", AI_OBSERVABILITY_SECRET: "fixture" }, authorize: mocks.authorize, repository: () => ({} as never), analyze });
    const context = { params: { bookingId: "1" } };
    const rejected = await handlers.POST(request("insight", { origin: "https://evil.invalid" }), context); expect(rejected.status).toBe(403); expect(rejected.headers.get("X-AI-Trace-Id")).toBeTruthy();
    const cached = await handlers.POST(request("insight"), context); expect(cached.status).toBe(200); expect(cached.headers.has("X-AI-Trace-Id")).toBe(false); expect(cached.headers.has("X-AI-Feedback-Token")).toBe(false);
    mocks.limit.mockResolvedValue({ ok: false, status: 429, retryAfter: 60 }); const limited = await handlers.POST(request("insight"), context); expect(limited.status).toBe(429); expect(limited.headers.get("Retry-After")).toBe("60");
  });
});

describe("safe generation error diagnostics", () => {
  it("ignores throwing getters while inspecting safe sibling fields", () => {
    const hostile = Object.defineProperties({}, {
      name: { get: () => { throw new Error("private getter"); } },
      cause: { get: () => { throw new Error("private cause getter"); } },
      lastError: { value: { name: "AI_APICallError", statusCode: 503, isRetryable: true } },
    });

    expect(() => safeGenerationErrorDiagnostic(hostile)).not.toThrow();
    expect(safeGenerationErrorDiagnostic(hostile)).toEqual({
      errorName: "AI_APICallError",
      code: "provider-http",
      status: 503,
      retryable: true,
    });
  });

  it("returns a stable fallback for a throwing Proxy", () => {
    const hostile = new Proxy({}, {
      get() {
        throw new Error("private proxy trap");
      },
    });

    expect(() => safeGenerationErrorDiagnostic(hostile)).not.toThrow();
    expect(safeGenerationErrorDiagnostic(hostile)).toEqual({
      errorName: "UnknownError",
      code: "generation-error",
      status: null,
      retryable: null,
    });
  });

  it("traverses cause and lastError with cycles without looping", () => {
    const root: Record<string, unknown> = { name: "AI_RetryError" };
    const cause: Record<string, unknown> = { statusCode: 503 };
    const lastError: Record<string, unknown> = { isRetryable: true };
    root.cause = cause;
    root.lastError = lastError;
    cause.cause = root;
    lastError.lastError = root;

    expect(safeGenerationErrorDiagnostic(root)).toEqual({
      errorName: "AI_RetryError",
      code: "provider-http",
      status: 503,
      retryable: true,
    });
  });

  it("accepts only provider HTTP error statuses", () => {
    expect(safeGenerationErrorDiagnostic({ statusCode: 399 })).toMatchObject({
      code: "generation-error",
      status: null,
    });
    expect(safeGenerationErrorDiagnostic({ statusCode: 400 })).toMatchObject({
      code: "provider-http",
      status: 400,
    });
    expect(safeGenerationErrorDiagnostic({ statusCode: 599 })).toMatchObject({
      code: "provider-http",
      status: 599,
    });
    expect(safeGenerationErrorDiagnostic({ statusCode: 600 })).toMatchObject({
      code: "generation-error",
      status: null,
    });
  });
});

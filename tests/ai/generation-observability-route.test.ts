import { POST as concierge } from "@/app/api/ai/concierge/route";
import { POST as operations } from "@/app/api/ai/admin/route";
import { createBookingInsightRouteHandlers } from "@/app/_ai/booking-insight-route";
const mocks = vi.hoisted(() => ({ persist: vi.fn(), limit: vi.fn(), authorize: vi.fn(), stream: vi.fn(), generate: vi.fn(), observer: null as any }));
vi.mock("@/app/_ai/observability/run", async original => { const actual = await original<typeof import("@/app/_ai/observability/run")>(); return { ...actual, createRunObserver: (options: any) => actual.createRunObserver({ ...options, persist: mocks.persist }) }; });
vi.mock("@/app/_ai/observability/access", async original => ({ ...await original<typeof import("@/app/_ai/observability/access")>(), enforceRateLimit: mocks.limit }));
vi.mock("@/app/_ai/providers/concierge-model", async original => ({ ...await original<typeof import("@/app/_ai/providers/concierge-model")>(), getConciergeProviderConfigurationError: () => null, resolveConciergeProviderConfiguration: () => ({ modelId: "fixture-model" }) }));
vi.mock("@/app/_ai/operations-auth", () => ({ authorizeOperationsStaff: mocks.authorize }));
vi.mock("@/app/_ai/agents/concierge-agent", () => ({ CONCIERGE_INSTRUCTIONS: "fixture", createConciergeAgent: (options: any) => { mocks.observer = options.observer; return {}; } }));
vi.mock("@/app/_ai/agents/operations-agent", () => ({ OPERATIONS_INSTRUCTIONS: "fixture", createOperationsAgent: (options: any) => { mocks.observer = options.observer; return { tools: {}, generate: mocks.generate }; } }));
vi.mock("ai", async original => ({ ...await original<typeof import("ai")>(), createAgentUIStreamResponse: mocks.stream }));
function request(surface: string, options: { origin?: string; signal?: AbortSignal } = {}) {
  return new Request(`http://localhost/api/ai/${surface}`, { method: "POST", signal: options.signal, headers: { "content-type": "application/json", accept: "application/json", ...(options.origin ? { origin: options.origin } : {}) }, body: JSON.stringify(surface === "insight" ? {} : { messages: [{ id: "fixture", role: "user", parts: [{ type: "text", text: "Show arrivals" }] }] }) });
}
describe("generation routes preserve trace and failure semantics", () => {
  beforeEach(() => { vi.stubEnv("AI_OBSERVABILITY_SECRET", "fixture-secret"); mocks.persist.mockResolvedValue(true); mocks.limit.mockResolvedValue({ ok: true }); mocks.authorize.mockResolvedValue({ ok: true, client: {}, user: { id: "synthetic" } }); mocks.stream.mockRejectedValue(new Error("private@example.invalid")); mocks.generate.mockRejectedValue(new Error("private@example.invalid")); });
  afterEach(() => { vi.unstubAllEnvs(); });
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
  it("booking insight rejects early paths with trace, while cache hits have no generation receipt", async () => {
    const analyze = vi.fn().mockResolvedValue({ state: "fresh", insight: null });
    const handlers = createBookingInsightRouteHandlers({ env: { NODE_ENV: "test", AI_OBSERVABILITY_SECRET: "fixture" }, authorize: mocks.authorize, repository: () => ({} as never), analyze });
    const context = { params: { bookingId: "1" } };
    const rejected = await handlers.POST(request("insight", { origin: "https://evil.invalid" }), context); expect(rejected.status).toBe(403); expect(rejected.headers.get("X-AI-Trace-Id")).toBeTruthy();
    const cached = await handlers.POST(request("insight"), context); expect(cached.status).toBe(200); expect(cached.headers.has("X-AI-Trace-Id")).toBe(false); expect(cached.headers.has("X-AI-Feedback-Token")).toBe(false);
    mocks.limit.mockResolvedValue({ ok: false, status: 429, retryAfter: 60 }); const limited = await handlers.POST(request("insight"), context); expect(limited.status).toBe(429); expect(limited.headers.get("Retry-After")).toBe("60");
  });
});

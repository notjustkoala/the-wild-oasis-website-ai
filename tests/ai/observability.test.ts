import { createRunObserver } from "@/app/_ai/observability/run";
import { enforceRateLimit, issueFeedbackToken, verifyFeedbackToken } from "@/app/_ai/observability/access";
const env = { NODE_ENV: "test", AI_OBSERVABILITY_SECRET: "fixture-secret-no-real-credentials" } as NodeJS.ProcessEnv;
const trace = "00000000-0000-4000-8000-000000000005";
describe("AI metadata and permission boundaries", () => {
  it.each(["timeout", "cancelled"] as const)("does not label partial step usage as a complete %s total", async status => {
    const run = createRunObserver({ surface: "concierge", promptVersion: "v1", persist: async () => true });
    run.step({ usage: { inputTokens: 10, outputTokens: 5 } });
    expect(await run.finish(status, status)).toMatchObject({ status, input_tokens: null, output_tokens: null });
  });
  it.each(["error", "abort"])("records streamed %s while preserving chunks", async type => {
    const persist = vi.fn().mockResolvedValue(true), controller = new AbortController();
    const run = createRunObserver({ surface: "concierge", promptVersion: "v1", persist });
    const transform = run.transform(controller.signal)({} as never);
    const writer = transform.writable.getWriter(), reader = transform.readable.getReader();
    const reading = reader.read();
    await writer.write({ type, error: new Error("private error") } as never);
    expect((await reading).value?.type).toBe(type);
    const end = reader.read(); await writer.close(); await end;
    expect(await run.finish()).toMatchObject({ status: type === "abort" ? "timeout" : "failed", ttft_ms: null });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(persist.mock.calls)).not.toContain("private error");
  });
  it("persists whitelisted metadata once and preserves tool failures", async () => {
    const persist = vi.fn().mockResolvedValue(true); let time = 100;
    const run = createRunObserver({ surface: "concierge", promptVersion: "v1", now: () => time, persist });
    time = 120; run.firstText(); time = 130; run.firstText();
    run.step({ toolCalls: [{ toolName: "searchAvailableCabins" }, { toolName: "secret@example.invalid" }], content: [{ type: "tool-error" }], usage: { inputTokens: 20, outputTokens: 10 } });
    const first = run.finish(), second = run.finish("completed");
    expect(first).toBe(second);
    expect(await first).toMatchObject({ status: "failed", error_code: "tool-error", ttft_ms: 20, duration_ms: 30, tool_names: ["searchAvailableCabins"], input_tokens: 20 });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(persist.mock.calls)).not.toMatch(/example|prompt"|input"|output"|message/);
  });
  it("propagates unknown usage across steps", async () => {
    const run = createRunObserver({ surface: "operations", promptVersion: "v1", persist: async () => true });
    run.step({ usage: { inputTokens: 5, outputTokens: 2 } }); run.step({ usage: { outputTokens: 2 } }); run.step({ usage: { inputTokens: 5, outputTokens: 2 } });
    expect(await run.finish()).toMatchObject({ input_tokens: null, output_tokens: 6, ttft_ms: null });
  });
  it("preserves an explicit provider failure after an earlier recoverable tool error", async () => {
    const run = createRunObserver({ surface: "operations", promptVersion: "v1", persist: async () => true });
    run.step({ content: [{ type: "tool-error" }], usage: { inputTokens: 20, outputTokens: 10 } });
    expect(await run.finish("failed", "provider-unavailable")).toMatchObject({ status: "failed", error_code: "provider-unavailable", tool_error_count: 1, input_tokens: null, output_tokens: null });
  });
  it("keeps a previously marked cancellation when a later callback reports failure", async () => {
    const run = createRunObserver({ surface: "operations", promptVersion: "v1", persist: async () => true });
    run.mark("cancelled", "cancelled");
    expect(await run.finish("failed", "provider-unavailable")).toMatchObject({ status: "cancelled", error_code: "cancelled", input_tokens: null, output_tokens: null });
  });
  it("does not price partial usage when a later provider step fails", async () => {
    const run = createRunObserver({ surface: "concierge", promptVersion: "v1", persist: async () => true });
    run.step({ usage: { inputTokens: 20, outputTokens: 10 } });
    run.mark("failed", "provider-unavailable");
    expect(await run.finish()).toMatchObject({ status: "failed", input_tokens: null, output_tokens: null });
  });
  it("records cancellation without transform flush", async () => {
    const persist = vi.fn().mockResolvedValue(true), controller = new AbortController();
    const run = createRunObserver({ surface: "operations", promptVersion: "v1", persist });
    run.watch(controller.signal); controller.abort();
    expect(await run.finish()).toMatchObject({ status: "cancelled", error_code: "cancelled" }); expect(persist).toHaveBeenCalledTimes(1);
  });
  it("isolates persistence failures", async () => {
    const run = createRunObserver({ surface: "operations", promptVersion: "v1", persist: async () => { throw new Error("private exception"); } });
    expect(await run.finish()).toMatchObject({ status: "completed" });
  });
  it("bounds hanging persistence", async () => {
    vi.useFakeTimers(); try { const run = createRunObserver({ surface: "concierge", promptVersion: "v1", persist: () => new Promise(() => {}) }); const result = run.finish(); await vi.advanceTimersByTimeAsync(1_600); await expect(result).resolves.toMatchObject({ status: "completed" }); } finally { vi.useRealTimers(); }
  });
  it("binds feedback to run, surface, signature and expiry", () => {
    const now = 1_800_000_000_000, token = issueFeedbackToken(trace, "concierge", env, now)!;
    expect(verifyFeedbackToken(token, trace, env, now)).toBe("concierge");
    expect(verifyFeedbackToken(token, trace.replace(/5$/, "6"), env, now)).toBeNull();
    expect(verifyFeedbackToken(token.replace("concierge", "operations"), trace, env, now)).toBeNull();
    expect(verifyFeedbackToken(token, trace, env, now + 3_600_001)).toBeNull();
    expect(verifyFeedbackToken(trace, trace, env, now)).toBeNull();
  });
  it("uses one anonymous bucket and hashes employee identity", async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true, retry_after: 60 });
    await enforceRateLimit("concierge", undefined, { env, consume }); await enforceRateLimit("concierge", undefined, { env, consume }); await enforceRateLimit("operations", "private-user", { env, consume });
    expect(consume.mock.calls[0][0]).toBe(consume.mock.calls[1][0]); expect(JSON.stringify(consume.mock.calls)).not.toContain("private-user");
  });
  it("returns 429 and fails closed when store is unavailable", async () => {
    expect(await enforceRateLimit("concierge", undefined, { env, consume: async () => ({ allowed: false, retry_after: 20 }) })).toMatchObject({ ok: false, status: 429, retryAfter: 20 });
    expect(await enforceRateLimit("concierge", undefined, { env, consume: async () => { throw new Error("private"); } })).toMatchObject({ ok: false, status: 503 });
  });
  it("bounds a hanging rate store", async () => {
    vi.useFakeTimers(); try { const promise = enforceRateLimit("concierge", undefined, { env, consume: () => new Promise(() => {}) }); await vi.advanceTimersByTimeAsync(1_600); expect(await promise).toMatchObject({ status: 503 }); } finally { vi.useRealTimers(); }
  });
});

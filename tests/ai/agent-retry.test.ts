import { APICallError } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

import { createConciergeAgent } from "@/app/_ai/agents/concierge-agent";
import { createOperationsAgent } from "@/app/_ai/agents/operations-agent";
import { CONCIERGE_GENERATE_TIMEOUT } from "@/app/_ai/concierge-stream";
import { CONCIERGE_MODEL_MAX_RETRIES } from "@/app/_ai/providers/concierge-model";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function retryableProviderFailure() {
  return new APICallError({
    message: "temporary provider failure",
    url: "https://provider.invalid/generate",
    requestBodyValues: undefined,
    statusCode: 503,
    responseHeaders: { "retry-after-ms": "0" },
    responseBody: "private provider body",
    isRetryable: true,
  });
}

function recoveringModel() {
  const doGenerate = vi.fn(async () => {
    if (doGenerate.mock.calls.length <= CONCIERGE_MODEL_MAX_RETRIES) {
      throw retryableProviderFailure();
    }
    return {
      content: [{ type: "text" as const, text: "Recovered." }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage,
      warnings: [],
    };
  });
  return {
    doGenerate,
    model: new MockLanguageModelV4({ doGenerate }),
  };
}

function successfulText(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function controlledDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      reject(signal.reason);
    }, { once: true });
  });
}

function emptyOperationsClient() {
  const builder: Record<string, any> = {
    select: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({ data: [], error: null })),
  };
  return { builder, client: { from: vi.fn(() => builder) } };
}

function threeOperationsToolCalls() {
  return {
    content: ["getBookingMetrics", "getArrivals", "getBookingRisks"].map((toolName) => ({
      type: "tool-call" as const,
      toolCallId: `call-${toolName}`,
      toolName,
      input: JSON.stringify({ from: "2026-09-01", to: "2026-09-30" }),
    })),
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function mockAbortSignalTimeout() {
  return vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException(
      `The operation timed out after ${milliseconds}ms`,
      "TimeoutError",
    )), milliseconds);
    return controller.signal;
  });
}

function mockAbortSignalAny() {
  const originalDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  Object.defineProperty(AbortSignal, "any", {
    configurable: true,
    value: (signals: AbortSignal[]) => {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort(signal.reason);
          break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      }
      return controller.signal;
    },
  });
  return () => {
    if (originalDescriptor) Object.defineProperty(AbortSignal, "any", originalDescriptor);
    else delete (AbortSignal as unknown as { any?: unknown }).any;
  };
}

async function flushMicrotasksUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    vi.runAllTicks();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
  throw new Error("The expected asynchronous operation did not start.");
}

describe("agent provider retries", () => {
  it("retries a transient 503 four times for the concierge agent", async () => {
    const { doGenerate, model } = recoveringModel();
    const result = await createConciergeAgent({ model }).generate({ prompt: "Hello" });

    expect(result.text).toBe("Recovered.");
    expect(doGenerate).toHaveBeenCalledTimes(CONCIERGE_MODEL_MAX_RETRIES + 1);
    expect(model.doGenerateCalls[0]?.reasoning).toBeUndefined();
  });

  it("retries a transient 503 four times before any operations tool execution", async () => {
    const { doGenerate, model } = recoveringModel();
    const from = vi.fn(() => {
      throw new Error("No query expected before a model response.");
    });
    const rpc = vi.fn(() => {
      throw new Error("No RPC expected before a model response.");
    });
    const result = await createOperationsAgent({
      client: { from, rpc },
      actorId: "staff-fixture",
      model,
      referenceDate: new Date("2026-09-29T00:00:00Z"),
    }).generate({ prompt: "Show arrivals today." });

    expect(result.text).toBe("Recovered.");
    expect(doGenerate).toHaveBeenCalledTimes(CONCIERGE_MODEL_MAX_RETRIES + 1);
    expect(model.doGenerateCalls[0]?.reasoning).toBe("low");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows a 70-second operations provider step and then completes three read-only tools", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const restoreAbortTimeout = mockAbortSignalTimeout();
    const restoreAbortAny = mockAbortSignalAny();
    try {
      const { builder, client } = emptyOperationsClient();
      const doGenerate = vi.fn(async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
        if (doGenerate.mock.calls.length === 1) {
          await controlledDelay(70_000, abortSignal);
          return threeOperationsToolCalls();
        }
        return successfulText("Completed after the structured tools.");
      });
      const generation = createOperationsAgent({
        client,
        actorId: "staff-fixture",
        model: new MockLanguageModelV4({ doGenerate }),
        referenceDate: new Date("2026-09-30T00:00:00Z"),
      }).generate({
        prompt: "Show September metrics, arrivals, and risks.",
        timeout: CONCIERGE_GENERATE_TIMEOUT,
      });
      let settlement: { status: "fulfilled" | "rejected"; value: unknown } | undefined;
      void generation.then(
        (value) => { settlement = { status: "fulfilled", value }; },
        (error) => { settlement = { status: "rejected", value: error }; },
      );

      await flushMicrotasksUntil(() => doGenerate.mock.calls.length === 1 || settlement !== undefined);
      if (settlement?.status === "rejected") throw settlement.value;
      expect(settlement).toBeUndefined();
      expect(doGenerate).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_001);
      expect(settlement).toBeUndefined();
      await vi.advanceTimersByTimeAsync(9_999);

      await expect(generation).resolves.toMatchObject({
        text: "Completed after the structured tools.",
      });
      expect(doGenerate).toHaveBeenCalledTimes(2);
      expect(builder.limit).toHaveBeenCalledTimes(3);
    } finally {
      restoreAbortAny();
      restoreAbortTimeout.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps the complete operations agent bounded by the 90-second total timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const restoreAbortTimeout = mockAbortSignalTimeout();
    const restoreAbortAny = mockAbortSignalAny();
    try {
      const { builder, client } = emptyOperationsClient();
      const doGenerate = vi.fn(async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
        if (doGenerate.mock.calls.length === 1) {
          await controlledDelay(70_000, abortSignal);
          return threeOperationsToolCalls();
        }
        await controlledDelay(30_000, abortSignal);
        return successfulText("Too late.");
      });
      const generation = createOperationsAgent({
        client,
        actorId: "staff-fixture",
        model: new MockLanguageModelV4({ doGenerate }),
        referenceDate: new Date("2026-09-30T00:00:00Z"),
      }).generate({
        prompt: "Show September metrics, arrivals, and risks.",
        timeout: CONCIERGE_GENERATE_TIMEOUT,
      });
      let settlement: { status: "fulfilled" | "rejected"; value: unknown } | undefined;
      void generation.then(
        (value) => { settlement = { status: "fulfilled", value }; },
        (error) => { settlement = { status: "rejected", value: error }; },
      );

      await flushMicrotasksUntil(() => doGenerate.mock.calls.length === 1 || settlement !== undefined);
      if (settlement?.status === "rejected") throw settlement.value;
      expect(settlement).toBeUndefined();
      expect(doGenerate).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(89_999);
      expect(settlement).toBeUndefined();
      expect(builder.limit).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);

      await expect(generation).rejects.toMatchObject({ name: "TimeoutError" });
      expect(doGenerate).toHaveBeenCalledTimes(2);
    } finally {
      restoreAbortAny();
      restoreAbortTimeout.mockRestore();
      vi.useRealTimers();
    }
  });
});

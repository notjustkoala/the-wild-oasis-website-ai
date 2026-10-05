import type { TextStreamPart, ToolSet } from "ai";

import {
  CONCIERGE_RECOVERABLE_ERROR,
  CONCIERGE_TIMEOUT,
  createConciergeAbortRecoveryTransform,
  conciergeStreamErrorMessage,
} from "@/app/_ai/concierge-stream";
import { ConciergeInputError, CONCIERGE_INPUT_NOTICE_PREFIX } from "@/app/_ai/tools/input-error";

async function transformParts(
  signal: AbortSignal,
  parts: TextStreamPart<ToolSet>[]
) {
  const stream = new ReadableStream<TextStreamPart<ToolSet>>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  }).pipeThrough(createConciergeAbortRecoveryTransform(signal)({
    tools: {},
    stopStream: vi.fn(),
  }));
  const reader = stream.getReader();
  const output: TextStreamPart<ToolSet>[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return output;
    output.push(value);
  }
}

describe("concierge stream recovery", () => {
  it("distinguishes application validation, real timeouts and private tool failures", () => {
    const trace = "00000000-0000-4000-8000-000000000001";
    expect(conciergeStreamErrorMessage(new ConciergeInputError("Stay length must be between 3 and 30 nights"), trace))
      .toBe(`${CONCIERGE_INPUT_NOTICE_PREFIX}Stay length must be between 3 and 30 nights`);
    expect(conciergeStreamErrorMessage(new DOMException("private detail", "TimeoutError"), trace))
      .toBe(`${CONCIERGE_RECOVERABLE_ERROR} Reference: ${trace}`);
    const failure = conciergeStreamErrorMessage(new Error("private database timeout password"), trace);
    expect(failure).toContain("could not load the requested data");
    expect(failure).toContain(trace);
    expect(failure).not.toMatch(/took too long|private|password|database/);
    expect(conciergeStreamErrorMessage({ name: "AI_ToolExecutionError", cause: new DOMException("private", "TimeoutError") }, trace))
      .toContain(CONCIERGE_RECOVERABLE_ERROR);
  });

  it("converts a server timeout abort into a client-visible safe error", async () => {
    const output = await transformParts(new AbortController().signal, [
      { type: "abort", reason: "TimeoutError: secret internal detail" },
    ]);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ type: "error" });
    expect((output[0] as { error: Error }).error.message).toBe(
      CONCIERGE_RECOVERABLE_ERROR
    );
    expect(conciergeStreamErrorMessage((output[0] as { error: Error }).error, "trace")).toContain(CONCIERGE_RECOVERABLE_ERROR);
    expect(JSON.stringify(output)).not.toMatch(/secret internal detail/);
  });

  it("preserves abort when the browser explicitly cancels the request", async () => {
    const controller = new AbortController();
    controller.abort("user stopped");
    await expect(
      transformParts(controller.signal, [{ type: "abort", reason: "user stopped" }])
    ).resolves.toEqual([{ type: "abort", reason: "user stopped" }]);
  });

  it("keeps every timeout bounded within the route duration", () => {
    expect(CONCIERGE_TIMEOUT).toEqual({
      totalMs: 90_000,
      stepMs: 60_000,
      firstChunkMs: 60_000,
      chunkMs: 30_000,
      toolMs: 20_000,
    });
  });
});

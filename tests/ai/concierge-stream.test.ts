import type { TextStreamPart, ToolSet } from "ai";

import {
  CONCIERGE_RECOVERABLE_ERROR,
  CONCIERGE_TIMEOUT,
  createConciergeAbortRecoveryTransform,
} from "@/app/_ai/concierge-stream";

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
  it("converts a server timeout abort into a client-visible safe error", async () => {
    const output = await transformParts(new AbortController().signal, [
      { type: "abort", reason: "TimeoutError: secret internal detail" },
    ]);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ type: "error" });
    expect((output[0] as { error: Error }).error.message).toBe(
      CONCIERGE_RECOVERABLE_ERROR
    );
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

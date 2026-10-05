import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createAgentUIStreamResponse } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { createConciergeAgent } from "@/app/_ai/agents/concierge-agent";
import { conciergeStreamErrorMessage } from "@/app/_ai/concierge-stream";
import { createCabinTools, type ConciergeInventoryDataSource } from "@/app/_ai/tools/cabin-tools";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

it("serializes a rejected two-night search followed by a policy result and text without a false timeout", async () => {
  const source: ConciergeInventoryDataSource = {
    listCabins: vi.fn(async () => []), getCabins: vi.fn(async () => []),
    getCabin: vi.fn(async () => null), getConflictingCabinIds: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ id: 1, minBookingLength: 3, maxBookingLength: 30, maxGuestsPerBooking: 10, breakfastPrice: 15 })),
  };
  let step = 0;
  const model = new MockLanguageModelV4({ doStream: async () => {
    const first = step++ === 0;
    const parts: LanguageModelV4StreamPart[] = first ? [
      { type: "tool-call", toolCallId: "search", toolName: "searchAvailableCabins", input: JSON.stringify({ startDate: "2027-01-10", endDate: "2027-01-12", numGuests: 2, maxTotalPrice: 1200, preferences: [] }) },
      { type: "tool-call", toolCallId: "policy", toolName: "getHotelPolicy", input: "{}" },
    ] : [
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: "您选择了两晚，请调整为至少三晚。" },
      { type: "text-end", id: "answer" },
    ];
    parts.push({ type: "finish", usage, finishReason: { unified: first ? "tool-calls" : "stop", raw: undefined } });
    return { stream: new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close(); } }) };
  } });
  const response = await createAgentUIStreamResponse({
    agent: createConciergeAgent({ model, tools: createCabinTools(source) }),
    uiMessages: [{ id: "g1", role: "user", parts: [{ type: "text", text: "2027-01-10 到 2027-01-12，2 位客人" }] }],
    onError: error => conciergeStreamErrorMessage(error, "fixture-trace"),
  });
  const stream = await response.text();
  const events = stream.split(/\r?\n/).filter(line => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map(line => JSON.parse(line.slice(6)));
  expect(events.find(event => event.type === "tool-output-error")).toMatchObject({
    toolCallId: "search", errorText: "Request needs updating: Stay length must be between 3 and 30 nights",
  });
  expect(events.find(event => event.type === "tool-output-available")).toMatchObject({
    toolCallId: "policy", output: { kind: "hotel-policy", minBookingLength: 3, sourceIds: ["settings:1"] },
  });
  expect(stream).toContain("您选择了两晚，请调整为至少三晚。");
  expect(events.some(event => event.type === "error")).toBe(false);
  expect(stream).not.toContain("took too long");
  expect(step).toBe(2);
});

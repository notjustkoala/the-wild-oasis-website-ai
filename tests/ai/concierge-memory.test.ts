import { createAgentUIStreamResponse } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

import { collectConciergeDemand } from "@/app/_ai/concierge-memory";
import { prepareConciergeTurn, validateConciergeRequestBody } from "@/app/_ai/concierge-request";
import { createConciergeAgent } from "@/app/_ai/agents/concierge-agent";
import { createCabinTools, type ConciergeInventoryDataSource } from "@/app/_ai/tools/cabin-tools";

const initial = "11-10到11-13，2位客人，预算1200美元，希望安静。请推荐小屋。";
const complete = "2026年11月10日到11月13日，2位客人，预算1200美元，希望安静。请推荐小屋。";
const today = "2026-10-07";
function prepare(texts: string[]) {
  const valid = validateConciergeRequestBody({ messages: texts.map(text => ({ role: "user", parts: [{ type: "text", text }] })) });
  if (!valid.ok) throw new Error(valid.message);
  return prepareConciergeTurn(valid.uiMessages, today);
}
const expected = { startDate: "2026-11-10", endDate: "2026-11-13", numGuests: 2, maxTotalPrice: 1200, preferences: ["希望安静"] };
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
function stream(parts: LanguageModelV4StreamPart[]) {
  return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close(); } }) };
}

describe("accumulated guest stay requests", () => {
  it("asks only for the absent year, retaining month/day, party, budget and preference", () => {
    const turn = prepare([initial]);
    expect(turn.demandMemory).toMatchObject({ dates: { start: { month: 11, day: 10 }, end: { month: 11, day: 13 } }, numGuests: 2, maxTotalPrice: 1200, preferences: ["希望安静"], missing: ["year"], conflicts: [] });
    expect(turn.searchDemandNow).toBe(false);
    expect(JSON.stringify(turn.uiMessages)).toContain(today);
    expect(JSON.stringify(turn.uiMessages)).toContain('missing');
  });

  it("completes the exact reported conversation after the FIRST year clarification", () => {
    const texts = [initial];
    for (const reply of ["26年，是的三晚", "26年11月10日到11.13", "确认", "确认"]) {
      texts.push(reply);
      const turn = prepare(texts);
      expect(turn.demandMemory?.search).toEqual(expected);
      expect(turn.demandMemory?.missing).toEqual([]);
      expect(turn.searchDemandNow).toBe(true);
    }
  });

  it.each(["2026-11-10 到 2026-11-13", "2026年11月10日至13日", "26年11月10日到11.13", "今年11-10到11-13"])("normalizes dates without guessing a year: %s", date => {
    expect(prepare([`${date}，2位客人，请推荐小屋`]).demandMemory?.search).toMatchObject({ startDate: expected.startDate, endDate: expected.endDate, numGuests: 2 });
  });

  it.each(["26", "2026", "2026，是的三晚"])("accepts a bare answer to the missing year: %s", reply => {
    expect(prepare([initial, reply]).demandMemory?.search).toEqual(expected);
  });
  it("accepts a bare party count when dates are already known, without interpreting it as a year", () => {
    expect(prepare(["2026-11-10到2026-11-13，请推荐小屋", "2"]).demandMemory?.search).toMatchObject({ startDate: "2026-11-10", endDate: "2026-11-13", numGuests: 2 });
  });

  it("updates only explicitly changed fields and does not require optional budget or preferences", () => {
    const turn = prepare([complete, "改为四位客人，预算提高到1600美元", "退房改为11月14日"]);
    expect(turn.demandMemory?.search).toEqual({ ...expected, numGuests: 4, maxTotalPrice: 1600, endDate: "2026-11-14" });
    const noBudget = prepare([complete, "不限预算，不再要求安静，请重新查询"]);
    expect(noBudget.demandMemory?.search).toEqual({ startDate: expected.startDate, endDate: expected.endDate, numGuests: 2, preferences: [] });
    expect(prepare([complete, "偏好改为湖景，请推荐"]).demandMemory?.preferences).toEqual(["偏好改为湖景"]);
    expect(prepare([complete, "Four guests, please search again"]).demandMemory?.search?.numGuests).toBe(4);
    expect(prepare([complete, "改为两位成人、两位儿童，请重新查询"]).demandMemory?.search?.numGuests).toBe(4);
    expect(prepare(["一家四口，2026年11月10日至13日，请推荐"]).demandMemory?.search?.numGuests).toBe(4);
  });

  it.each([
    ["2026年2月30日到3月3日，2位客人，请查询", "invalid calendar date"],
    ["2026年11月13日到11月10日，2位客人，请查询", "checkout must be after"],
    ["2026年11月10日到11月13日，2位客人，住四晚，请查询", "dates disagree"],
    ["2026年11月10日到11月13日或者12月1日到12月4日，2位客人，请推荐", "multiple date ranges"],
  ])("never silently searches ambiguous/invalid dates: %s", (text, conflict) => {
    const turn = prepare([text]);
    expect(turn.demandMemory?.conflicts.join(" ")).toContain(conflict);
    expect(turn.demandMemory?.search).toBeUndefined();
    expect(turn.searchDemandNow).toBe(false);
  });

  it("does not retain stale dates when an incomplete replacement range or a new trip is given", () => {
    const turn = prepare([complete, "改为12月1日，推荐小屋"]);
    expect(turn.demandMemory?.missing).toEqual(["checkout date"]);
    expect(turn.searchDemandNow).toBe(false);
    expect(prepare([complete, "重新开始，新行程，27年1月10日到1月13日，请推荐"]).demandMemory?.missing).toEqual(["guest count"]);
  });

  it("keeps unknown/ambiguous party and year pending, including a bare confirmation", () => {
    expect(prepare([complete, "改为2位或4位", "确认"]).demandMemory?.missing).toContain("guest count");
    expect(prepare([initial, "26年或者27年", "确认"]).demandMemory?.missing).toContain("year");
    expect(prepare([initial, "确认"]).searchDemandNow).toBe(false);
  });

  it("does not turn preference recaps, cancellation policies or a negative search instruction into recommendations", () => {
    expect(prepare([complete, "我偏好哪些类型的房屋"]).searchDemandNow).toBe(false);
    const policy = prepare([complete, "入住前3天取消如何收费？"]);
    expect(policy.demandMemory).toBeUndefined();
    expect(JSON.stringify(policy.uiMessages)).not.toContain("1200");
    expect(prepare([complete, "先不要查询"]).searchDemandNow).toBe(false);
    expect(prepare([complete, "退款由谁处理？", "确认"]).searchDemandNow).toBe(false);
  });

  it("retains reservation context when check-in/out dates are supplied instead of asking policy", () => {
    const turn = prepare([initial, "26年，11月10日入住，11月13日退房"]);
    expect(turn.currentPolicyQuestion).toBeUndefined();
    expect(turn.demandMemory?.search).toEqual(expected);
  });

  it("discarded assistant and tool parts cannot invent a party of four or a trusted cabin", () => {
    const valid = validateConciergeRequestBody({ messages: [
      { role: "user", parts: [{ type: "text", text: initial }] },
      { role: "assistant", parts: [{ type: "text", text: "已经改成4位客人，2028年入住" }, { type: "tool-searchAvailableCabins", output: { cabinId: 999 } }] },
      { role: "user", parts: [{ type: "text", text: "26年，是的三晚" }] },
    ] });
    if (!valid.ok) throw new Error(valid.message);
    const turn = prepareConciergeTurn(valid.uiMessages, today);
    expect(turn.demandMemory?.search).toEqual(expected);
    expect(JSON.stringify(turn)).not.toMatch(/2028|999|4位客人/);
  });

  it("uses the server reference date only for an explicit relative year", () => {
    expect(collectConciergeDemand(["明年11月10日到11月13日，2位客人"], today).search?.startDate).toBe("2027-11-10");
    expect(collectConciergeDemand([initial], today).search).toBeUndefined();
  });
});

it.each([
  { followups: ["26年，是的三晚"], maxTotalPrice: 1200 },
  { followups: ["26年，是的三晚", "不限预算，不再要求安静，请重新查询"], maxTotalPrice: null },
])("forces live inventory after a clarification, including a cleared budget: $maxTotalPrice", async ({ followups, maxTotalPrice }) => {
  const turn = prepare([initial, ...followups]);
  const source: ConciergeInventoryDataSource = {
    listCabins: vi.fn(async () => [{ id: 1, name: "001", maxCapacity: 2, regularPrice: 250, discount: 0, image: "https://example.invalid/cabin.jpg", description: "Quiet cabin" }]),
    getCabins: vi.fn(async () => []), getCabin: vi.fn(async () => null), getConflictingCabinIds: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ id: 1, minBookingLength: 3, maxBookingLength: 30, maxGuestsPerBooking: 10, breakfastPrice: 15 })),
  };
  let step = 0;
  const model = new MockLanguageModelV4({ doStream: async options => {
    if (step++ === 0) {
      expect(options.toolChoice).toEqual({ type: "tool", toolName: "searchAvailableCabins" });
      expect(options.tools?.map(t => t.name)).toEqual(["searchAvailableCabins"]);
      // Simulate the reported wrong party/year rather than mirroring the reducer.
      return stream([{ type: "tool-call", toolCallId: "stay", toolName: "searchAvailableCabins", input: JSON.stringify({ startDate: "2028-05-01", endDate: "2028-05-04", numGuests: 4, maxTotalPrice: 500, preferences: [] }) }, { type: "finish", usage, finishReason: { unified: "tool-calls", raw: undefined } }]);
    }
    expect(options.toolChoice).toEqual({ type: "auto" });
    expect(JSON.stringify(options.prompt)).toContain('"totalPrice":750');
    return stream([{ type: "text-start", id: "answer" }, { type: "text-delta", id: "answer", delta: "推荐001，符合您的两人安静住宿需求。" }, { type: "text-end", id: "answer" }, { type: "finish", usage, finishReason: { unified: "stop", raw: undefined } }]);
  } });
  const response = await createAgentUIStreamResponse({ agent: createConciergeAgent({ model, tools: createCabinTools(source), demandMemory: turn.demandMemory, searchDemandNow: turn.searchDemandNow }), uiMessages: turn.uiMessages });
  const text = await response.text();
  expect(text).toContain('"totalPrice":750');
  expect(text).toContain(`"maxTotalPrice":${maxTotalPrice}`);
  expect(text).toContain("推荐001");
  expect(text).not.toContain('"type":"error"');
  expect(source.getConflictingCabinIds).toHaveBeenCalledWith(expect.objectContaining({ startDate: expected.startDate, endDate: expected.endDate }));
  expect(source.listCabins).toHaveBeenCalledOnce();
});

it("does not expose inventory tools while a supplied date range is missing its year", async () => {
  const turn = prepare([initial]);
  const model = new MockLanguageModelV4({ doStream: async options => {
    expect(options.tools?.map(t => t.name)).toEqual(["getHotelPolicy", "searchHotelPolicies"]);
    expect(options.prompt.filter(message => message.role === "user").flatMap(message => message.content).filter(part => part.type === "text").map(part => part.text).join("\n")).toContain('"missing":["year"]');
    return stream([{ type: "text-start", id: "year" }, { type: "text-delta", id: "year", delta: "您计划哪一年11月10日到13日入住？" }, { type: "text-end", id: "year" }, { type: "finish", usage, finishReason: { unified: "stop", raw: undefined } }]);
  } });
  const response = await createAgentUIStreamResponse({ agent: createConciergeAgent({ model, demandMemory: turn.demandMemory }), uiMessages: turn.uiMessages });
  expect(await response.text()).toContain("哪一年");
});

import { mkdirSync, writeFileSync } from "node:fs";
import { loadCases, runEvaluation, validateCases } from "./runner";
import { createConciergeAgent } from "@/app/_ai/agents/concierge-agent";
import { createCabinTools } from "@/app/_ai/tools/cabin-tools";
import { createEvaluationDataSource, createPromptAwareModel } from "./concierge-fixture";
import { markdown, summarize } from "./report";
import * as cabinToolsModule from "@/app/_ai/tools/cabin-tools";
import * as conciergeFixture from "./concierge-fixture";
import { MockLanguageModelV4 } from "ai/test";
import type { SearchAvailableCabinsResult } from "@/app/_ai/schemas/concierge";

describe("Feature05 offline evaluation", () => {
  it("rejects duplicate ids, unknown constraints and unknown fixture fields", () => {
    const sample = loadCases()[0];
    expect(() => validateCases([sample, sample])).toThrow(/Duplicate/);
    expect(() => validateCases([{ ...sample, hardConstraints: ["typo"] }])).toThrow();
    expect(() => validateCases([{ ...sample, unexpected: true }])).toThrow();
    expect(() => validateCases([{ ...sample, expectedStay: undefined }])).toThrow(/expectedStay/);
    expect(() => validateCases([{ ...sample, expectedStay: { ...sample.expectedStay, numNights: 99 } }])).toThrow(/nights/);
  });
  it("evaluates changed dates, party size and budget over successive turns", async () => {
    const agent = createConciergeAgent({ model: createPromptAwareModel(), tools: createCabinTools(createEvaluationDataSource()) });
    const first = "2 guests from 2027-01-10 to 2027-01-12 under $400";
    const revised = "Change to 6 guests from 2027-02-10 to 2027-02-14 under $1200";
    const before = await agent.generate({ messages: [{ role: "user", content: first }] });
    const after = await agent.generate({ messages: [{ role: "user", content: first }, { role: "assistant", content: before.text }, { role: "user", content: revised }] });
    expect(before.steps[0].toolCalls[0].input).toMatchObject({ numGuests: 2, startDate: "2027-01-10", endDate: "2027-01-12", maxTotalPrice: 400 });
    expect(after.steps[0].toolCalls[0].input).toMatchObject({ numGuests: 6, startDate: "2027-02-10", endDate: "2027-02-14", maxTotalPrice: 1200 });
  });
  it("fails invalid business constraints instead of accepting a present field", async () => {
    const sample = loadCases().find(row => row.surface === "concierge" && row.expectedTools?.includes("searchAvailableCabins"))!;
    const report = await runEvaluation([{ ...sample, input: { ...sample.input, inventory: "error" }, hardConstraints: ["trusted-quote"] }]);
    expect(report.failures[0].failures).toContain("constraint:trusted-quote");
  });
  const corruptions: Array<{ label: string; id?: string; mutate: (output: SearchAvailableCabinsResult) => unknown; failed: string[] }> = [
    { label: "wrong output kind", mutate: () => ({ kind: "unexpected" }), failed: ["trusted-quote", "capacity-budget", "available-only"] },
    { label: "wrong output kind for empty inventory", id: "concierge-none-01", mutate: () => ({ kind: "unexpected" }), failed: ["trusted-quote", "capacity-budget", "available-only"] },
    { label: "self-consistent wrong dates", mutate: output => ({ ...output, startDate: "2027-01-01", endDate: "2027-01-04", recommendations: output.recommendations.map(cabin => ({ ...cabin, startDate: "2027-01-01", endDate: "2027-01-04" })) }), failed: ["trusted-quote", "available-only"] },
    { label: "self-consistent wrong guest count", mutate: output => ({ ...output, numGuests: 1, recommendations: output.recommendations.map(cabin => ({ ...cabin, numGuests: 1 })) }), failed: ["capacity-budget", "available-only"] },
    { label: "self-consistent wrong budget", mutate: output => ({ ...output, maxTotalPrice: 400, recommendations: output.recommendations.map(cabin => ({ ...cabin, withinBudget: cabin.totalPrice <= 400 })) }), failed: ["capacity-budget", "available-only"] },
    { label: "self-consistent wrong nights", mutate: output => ({ ...output, numNights: 4, recommendations: output.recommendations.map(cabin => ({ ...cabin, numNights: 4, totalPrice: cabin.nightlyPrice * 4, withinBudget: cabin.nightlyPrice * 4 <= output.maxTotalPrice! })) }), failed: ["trusted-quote"] },
    { label: "both price fields altered", mutate: output => ({ ...output, recommendations: output.recommendations.map(cabin => ({ ...cabin, nightlyPrice: 1, totalPrice: output.numNights, withinBudget: true })) }), failed: ["trusted-quote"] },
    { label: "normal inventory incorrectly empty", mutate: output => ({ ...output, recommendations: [] }), failed: ["trusted-quote", "capacity-budget", "available-only"] },
    { label: "invented capacity", mutate: output => ({ ...output, recommendations: output.recommendations.map(cabin => ({ ...cabin, maxCapacity: 99 })) }), failed: ["capacity-budget"] },
    { label: "conflicting cabin substituted", id: "concierge-conflict-01", mutate: output => ({ ...output, recommendations: output.recommendations.map(cabin => ({ ...cabin, cabinId: 1 })) }), failed: ["available-only"] },
    { label: "duplicate cabin IDs", mutate: output => ({ ...output, recommendations: output.recommendations.map(() => output.recommendations[0]) }), failed: ["available-only"] },
  ];
  it.each(corruptions)("fails $label after executing the real search tool", async ({ id, mutate, failed }) => {
    const originalFactory = cabinToolsModule.createCabinTools;
    let executions = 0;
    const spy = vi.spyOn(cabinToolsModule, "createCabinTools").mockImplementation(source => {
      const tools = originalFactory(source);
      const execute = tools.searchAvailableCabins.execute!;
      return { ...tools, searchAvailableCabins: { ...tools.searchAvailableCabins, execute: async (input, options) => {
        const output = await execute(input, options);
        executions++;
        return mutate(output as SearchAvailableCabinsResult) as SearchAvailableCabinsResult;
      } } };
    });
    try {
      const sample = loadCases().find(row => row.id === (id ?? "concierge-normal-01"))!;
      const report = await runEvaluation([sample]);
      expect(executions).toBeGreaterThan(0);
      expect(report.results[0].tools).toContain("searchAvailableCabins");
      expect(report.failures[0].failures).toEqual(expect.arrayContaining(failed.map(name => `constraint:${name}`)));
    } finally { spy.mockRestore(); }
  });
  it("rejects stale tool arguments even when the tool returns the expected stay", async () => {
    const base = conciergeFixture.createPromptAwareModel();
    const modelSpy = vi.spyOn(conciergeFixture, "createPromptAwareModel").mockReturnValue(new MockLanguageModelV4({ doGenerate: async options => {
      const result = await base.doGenerate(options);
      return { ...result, content: result.content.map(part => part.type === "tool-call" ? { ...part, input: JSON.stringify({ ...JSON.parse(part.input), startDate: "2027-01-01", endDate: "2027-01-04", numGuests: 1, maxTotalPrice: 1000 }) } : part) };
    } }));
    const originalFactory = cabinToolsModule.createCabinTools;
    const inputs: unknown[] = [];
    const toolSpy = vi.spyOn(cabinToolsModule, "createCabinTools").mockImplementation(source => {
      const tools = originalFactory(source);
      const execute = tools.searchAvailableCabins.execute!;
      return { ...tools, searchAvailableCabins: { ...tools.searchAvailableCabins, execute: async (input, options) => {
        inputs.push(input);
        // Simulate a faulty adapter returning the correct original stay for a
        // wrong model call; checking output alone must not allow this to pass.
        return await execute({ ...input, startDate: "2026-09-10", endDate: "2026-09-13", numGuests: 2, maxTotalPrice: 900 }, options) as SearchAvailableCabinsResult;
      } } };
    });
    try {
      const report = await runEvaluation([loadCases()[0]]);
      expect(inputs).toEqual([expect.objectContaining({ startDate: "2027-01-01", numGuests: 1, maxTotalPrice: 1000 })]);
      expect(report.failures[0].failures).toEqual(expect.arrayContaining(["constraint:trusted-quote", "constraint:capacity-budget", "constraint:available-only"]));
    } finally { modelSpy.mockRestore(); toolSpy.mockRestore(); }
  });
  it("runs every fixed case without network access and writes opt-in reports", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline evaluation forbids network"));
    try {
      const cases = loadCases();
      expect(cases.length).toBeGreaterThanOrEqual(50);
      expect(cases.length).toBeLessThanOrEqual(100);
      expect(new Set(cases.map(row => row.id)).size).toBe(cases.length);
      const report = await runEvaluation(cases);
      if (process.env.AI_EVAL_WRITE_REPORT === "1") {
        mkdirSync("tests/ai/reports", { recursive: true });
        writeFileSync("tests/ai/reports/offline.json", JSON.stringify(report, null, 2) + "\n");
        writeFileSync("tests/ai/reports/offline.md", markdown(report));
      }
      expect(network).not.toHaveBeenCalled();
      expect(report.failures, JSON.stringify(report.failures)).toEqual([]);
    } finally { network.mockRestore(); }
  });
  it("retains failures and does not turn unavailable metrics into zero", () => {
    const report = summarize([{ id: "deliberately-bad", mode: "test", checks: { toolSelection: false, citations: null }, failures: ["toolSelection"], durationMs: 1, tools: [], status: "error" }]);
    expect(report.metrics.toolSelection).toEqual({ passed: 0, applicable: 1, skipped: 0, rate: 0 });
    expect(report.metrics.citations.rate).toBeNull();
    expect(markdown(report)).toContain("deliberately-bad");
  });
  it("fails a deliberately incorrect tool oracle after production execution", async () => {
    const sample = loadCases()[0];
    const report = await runEvaluation([{ ...sample, expectedTools: ["inventedTool"] }]);
    expect(report.failures[0].failures).toContain("toolSelection");
  });
});

import { prepareOpenAIPolicyMigration } from "../../scripts/prepare-openai-policy-migration.mjs";
import { createRunObserver } from "@/app/_ai/observability/run";

it("keeps dry-run independent of keys, providers and database writes", async () => {
  const generate = vi.fn();
  const report = await prepareOpenAIPolicyMigration({ args: ["--dry-run"], env: { NODE_ENV: "test" }, generate, write: false });
  expect(report).toMatchObject({ mode: "--dry-run", project: "fadfglcobmxxsawxlmpb", model: "text-embedding-3-small", dimensions: 768, documents: 7, chunks: 16 });
  expect(generate).not.toHaveBeenCalled();
});

it("rejects missing keys and insufficient budgets before any paid request", async () => {
  const generate = vi.fn();
  await expect(prepareOpenAIPolicyMigration({ args: ["--prepare", "--max-usd", "0"], env: { NODE_ENV: "test", OPENAI_API_KEY: "test-only" }, generate, write: false })).rejects.toThrow(/budget/);
  await expect(prepareOpenAIPolicyMigration({ args: ["--prepare", "--max-usd", "1"], env: { NODE_ENV: "test" }, generate, write: false })).rejects.toThrow(/OPENAI_API_KEY/);
  expect(generate).not.toHaveBeenCalled();
});

it("records provider usage and prepares a full corpus without connecting to a database", async () => {
  const generate = vi.fn(async (plan: any) => {
    for (const document of plan.documents) for (const chunk of document.chunks) chunk.embedding = Array(768).fill(0.01);
    return { inputTokens: 1000 };
  });
  const report = await prepareOpenAIPolicyMigration({ args: ["--prepare", "--max-usd", "1"], env: { NODE_ENV: "test", OPENAI_API_KEY: "test-only" }, generate, write: false });
  expect(report).toMatchObject({ databaseWrites: 0, inputTokens: 1000, actualInputUSD: 0.00002 });
  expect("payloadHash" in report && report.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(report)).not.toContain("test-only");
});

it("does not treat an incomplete token breakdown as a complete billable total", async () => {
  const run = createRunObserver({ surface: "concierge", promptVersion: "fixture", persist: async () => true });
  run.step({ usage: { inputTokens: 100, outputTokens: 20, inputTokenDetails: { noCacheTokens: 70, cacheReadTokens: 30, cacheWriteTokens: 0 }, outputTokenDetails: { reasoningTokens: 4 } } });
  run.step({ usage: { inputTokens: 100, outputTokens: 20 } });
  expect(await run.finish()).toMatchObject({ input_tokens: 200, output_tokens: 40, reasoning_tokens: null, cache_read_input_tokens: null, cache_write_input_tokens: null });
});

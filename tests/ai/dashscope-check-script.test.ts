import { checkDashScopeConnection } from "../../scripts/check-dashscope-connection.mjs";
import { prepareDashScopePolicyMigration } from "../../scripts/prepare-dashscope-policy-migration.mjs";

it("keeps dry-run checks independent of keys and paid requests", async () => {
  const fetch = vi.fn();
  expect(await checkDashScopeConnection({ args: ["--dry-run"], env: { NODE_ENV: "test" }, fetch })).toMatchObject({ modelCalls: 0, databaseWrites: 0, generation: "qwen3.7-plus", embedding: "text-embedding-v4" });
  const generate = vi.fn();
  expect(await prepareDashScopePolicyMigration({ args: ["--dry-run"], env: { NODE_ENV: "test" }, generate, write: false })).toMatchObject({ project: "fadfglcobmxxsawxlmpb", documents: 7, chunks: 16, databaseWrites: 0 });
  expect(fetch).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
});

it("fails before paid requests without a key or positive budget", async () => {
  const fetch = vi.fn();
  await expect(checkDashScopeConnection({ args: ["--live", "--max-cny", "0"], env: { NODE_ENV: "test" }, fetch })).rejects.toThrow(/budget/);
  await expect(checkDashScopeConnection({ args: ["--live", "--max-cny", "1"], env: { NODE_ENV: "test" }, fetch })).rejects.toThrow(/DASHSCOPE_API_KEY/);
  await expect(checkDashScopeConnection({ args: ["--live", "--max-cny", "0.0000001"], env: { NODE_ENV: "test", DASHSCOPE_API_KEY: "fixture-only" }, fetch })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  const generate = vi.fn();
  await expect(prepareDashScopePolicyMigration({ args: ["--prepare", "--max-cny", "0"], env: { NODE_ENV: "test" }, generate, write: false })).rejects.toThrow(/budget/);
  await expect(prepareDashScopePolicyMigration({ args: ["--prepare", "--max-cny", "1"], env: { NODE_ENV: "test" }, generate, write: false })).rejects.toThrow(/DASHSCOPE_API_KEY/);
  expect(generate).not.toHaveBeenCalled();
});

it("prepares the corpus with usage and model identity without database writes", async () => {
  const generate = vi.fn(async (plan: any) => {
    for (const document of plan.documents) for (const chunk of document.chunks) chunk.embedding = Array(768).fill(0.01);
    return { inputTokens: 1000 };
  });
  const report = await prepareDashScopePolicyMigration({ args: ["--prepare", "--max-cny", "1"], env: { NODE_ENV: "test", DASHSCOPE_API_KEY: "fixture-only" }, generate, write: false });
  expect(report).toMatchObject({ model: "text-embedding-v4", dimensions: 768, databaseWrites: 0, inputTokens: 1000, estimatedUsageCNY: 0.0005 });
  expect("payloadHash" in report && report.payloadHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(report)).not.toContain("fixture-only");
});

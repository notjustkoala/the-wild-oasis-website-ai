import { spawnSync } from "node:child_process";
if (process.argv.slice(2).length) {
  console.error("Offline evaluation accepts no arguments. Use eval:ai:live for explicit remote measurement.");
  process.exit(2);
}
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/ai/evals/feature05-eval.test.ts"], { stdio: "inherit", env: { ...process.env, AI_EVAL_WRITE_REPORT: "1" } });
process.exit(result.status ?? 1);

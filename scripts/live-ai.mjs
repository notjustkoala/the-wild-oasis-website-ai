import { spawnSync } from "node:child_process";
if (!process.argv.includes("--live")) {
  console.error("Live models are opt-in. Run npm run eval:ai:live -- --live (10 synthetic scenarios; may incur model charges).");
  process.exit(2);
}
const args = process.argv.slice(2), selected = [];
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--live") continue;
  if (args[index] !== "--case" || !/^live-\d{2}-[a-z-]+$/.test(args[index + 1] ?? "")) { console.error("Usage: --live [--case live-05-empty] (repeat --case to select fixed cases)"); process.exit(2); }
  selected.push(args[++index]);
}
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.live.config.mjs"], { stdio: "inherit", env: { ...process.env, AI_EVAL_LIVE: "1", AI_EVAL_CASES: selected.join(",") } });
process.exit(result.status ?? 1);

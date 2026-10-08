import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2), selected = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') continue;
  if (args[i] !== '--case' || !/^live-\d{2}-[a-z-]+$/.test(args[i+1] ?? '')) {
    console.error('Usage: --live [--case live-01-missing]'); process.exit(2);
  }
  selected.push(args[++i]);
}
if (!args.includes('--live')) {
  console.error('Opt-in only: npm run eval:ai:dashscope -- --live (synthetic tools, no database writes; at most CNY 1 reserved).');
  process.exit(2);
}
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.dashscope-closeout.config.mjs'], {
  stdio: 'inherit', env: { ...process.env, AI_CLOSEOUT_LIVE: '1', AI_CLOSEOUT_CASES: selected.join(',') },
});
process.exit(result.status ?? 1);

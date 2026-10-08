import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

if (process.env.AI_CLOSEOUT_LIVE !== '1') throw new Error('Explicit live entrypoint required.');
process.loadEnvFile('.env.development.local');
if (process.env.AI_PROVIDER !== 'dashscope') throw new Error('DashScope configuration required.');
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)), 'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)) } },
  test: { environment: 'node', globals: true, include: ['tests/live/dashscope-closeout.live.test.ts'], testTimeout: 900_000, poolOptions: { forks: { singleFork: true } } },
});

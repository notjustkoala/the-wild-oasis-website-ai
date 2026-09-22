import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
if (process.env.AI_EVAL_LIVE !== "1") throw new Error("Use the explicit --live entrypoint.");
for (const file of [".env.development.local", ".env.local"]) {
  try { process.loadEnvFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (process.env.SUPABASE_URL !== "https://tupdbxiujsfaifqulgmt.supabase.co") throw new Error("Live evaluation requires the approved development project.");
export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)) } }, test: { environment: "node", globals: true, include: ["tests/live/*.test.ts"], testTimeout: 1_200_000, poolOptions: { forks: { singleFork: true } } } });

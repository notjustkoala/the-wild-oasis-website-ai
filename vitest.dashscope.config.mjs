import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
if (process.env.AI_RAG_CALIBRATE !== "1") throw new Error("Explicit DashScope calibration entrypoint required.");
for (const file of [".env.development.local", ".env.local"]) {
  try { process.loadEnvFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)) } }, test: { environment: "node", globals: true, include: ["tests/ai/dashscope-retrieval-preparation.live.ts", "tests/ai/dashscope-operations.live.ts"], testTimeout: 120_000, poolOptions: { forks: { singleFork: true } } } });

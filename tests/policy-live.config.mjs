import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Explicit opt-in only: creates temporary Auth fixtures and calls live Gemini.
export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("..", import.meta.url)),
    "server-only": fileURLToPath(new URL("./server-only-stub.ts", import.meta.url)),
  } },
  test: {
    environment: "node", globals: true,
    include: ["tests/ai/policy-closeout.live.ts"],
    testTimeout: 120_000, hookTimeout: 60_000,
  },
});

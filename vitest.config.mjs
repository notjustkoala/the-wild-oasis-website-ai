import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/server-only-stub.ts", import.meta.url)
      ),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "tests/e2e/**", "tests/live/**"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    clearMocks: true,
  },
});

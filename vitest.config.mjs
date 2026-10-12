import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { transformWithEsbuild } from "vite";

export default defineConfig({
  plugins: [{
    name: "next-jsx-in-js",
    enforce: "pre",
    transform(source, id) {
      if (/\/app\/.*\.js$/.test(id)) {
        return transformWithEsbuild(source, id, { loader: "jsx", jsx: "automatic" });
      }
    },
  }],
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

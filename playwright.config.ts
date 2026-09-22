import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, timeout: 60_000,
  outputDir: "test-results/e2e", reporter: [["list"], ["json", { outputFile: "test-results/e2e-results.json" }]],
  use: { baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3100", channel: process.env.E2E_BROWSER_CHANNEL || "msedge", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev -- --hostname 127.0.0.1 --port 3100", url: "http://127.0.0.1:3100", reuseExistingServer: false, timeout: 120_000, env: { NEXT_BUILD_OUTPUT_DIR: ".next-e2e" } },
});

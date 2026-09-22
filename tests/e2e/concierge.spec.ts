import { test, expect, type Page } from "@playwright/test";
// Actual Next pages + HTTP AI fixtures. Cabin SSR uses configured dev DB reads.
const traceId = "00000000-0000-4000-8000-000000000005";
const headers = { "x-ai-trace-id": traceId, "x-ai-feedback-token": "browser-fixture-not-a-real-permission", "x-vercel-ai-ui-message-stream": "v1" };
function stream(text: string) { return [{ type: "start", messageId: "fixture-answer" }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: text }, { type: "text-end", id: "text" }, { type: "finish", finishReason: "stop" }].map(row => `data: ${JSON.stringify(row)}\n\n`).join("") + "data: [DONE]\n\n"; }
async function ask(page: Page) { await page.goto("/"); await page.getByRole("button", { name: /AI concierge/i }).click(); await page.getByLabel("Message the AI concierge").fill("2 guests from 2027-01-10 to 2027-01-12"); await page.getByRole("button", { name: "Send", exact: true }).click(); }
test("successful response, trace and controlled feedback", async ({ page }) => {
  await page.route("**/api/ai/concierge", route => route.fulfill({ contentType: "text/event-stream", headers, body: stream("Cabin search completed. Review your dates.") }));
  await page.route("**/api/ai/feedback", async route => { expect(route.request().postDataJSON()).toEqual({ traceId, token: headers["x-ai-feedback-token"], rating: "helpful" }); await route.fulfill({ json: { saved: true } }); });
  await ask(page); await expect(page.getByText("Cabin search completed. Review your dates.")).toBeVisible(); await expect(page.getByText(traceId, { exact: true })).toBeVisible();
  await page.screenshot({ path: "output/playwright/feature05-success.png", fullPage: true });
  await page.getByRole("button", { name: "Helpful", exact: true }).click(); await expect(page.getByText("Feedback saved.")).toBeVisible();
});
test("no results leaves ordinary cabin filtering and reservation entry available", async ({ page }) => {
  await page.route("**/api/ai/concierge", route => route.fulfill({ contentType: "text/event-stream", headers, body: stream("No cabins are available for those dates. Try other dates.") }));
  await ask(page); await expect(page.getByText(/No cabins are available/)).toBeVisible();
  await page.screenshot({ path: "output/playwright/feature05-empty.png", fullPage: true });
  await page.getByRole("link", { name: "Browse cabins without AI" }).click(); await expect(page).toHaveURL(/\/cabins/);
  await page.getByRole("button", { name: "All Cabins" }).click(); await expect(page).toHaveURL(/capacity=all/);
  await page.getByRole("link", { name: /Details.*reservation/i }).first().click(); await expect(page).toHaveURL(/\/cabins\/\d+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Reserve/i })).toBeVisible();
});
for (const status of [504, 403]) test(`@security HTTP ${status} shows trace, supports retry and manual flow`, async ({ page }) => {
  let calls = 0;
  await page.route("**/api/ai/concierge", route => { calls++; return calls === 1 ? route.fulfill({ status, headers: { "x-ai-trace-id": traceId }, json: { error: status === 403 ? "Access denied." : "Model timed out.", traceId } }) : route.fulfill({ contentType: "text/event-stream", headers, body: stream("Retry completed.") }); });
  await ask(page); await expect(page.getByRole("dialog", { name: "AI Concierge" }).getByRole("alert")).toBeVisible(); await expect(page.getByText(traceId, { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Helpful", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `output/playwright/feature05-${status === 504 ? "timeout" : "denied"}.png`, fullPage: true });
  await page.getByRole("button", { name: "Retry last request" }).click(); await expect(page.getByText("Retry completed.")).toBeVisible();
  await page.getByRole("link", { name: "Browse cabins without AI" }).click(); await expect(page.getByRole("button", { name: "All Cabins" })).toBeVisible();
});
test("stops a pending response and permits another request", async ({ page }) => {
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/ai/concierge", async route => { await pending; await route.abort().catch(() => {}); });
  await ask(page); await page.getByRole("button", { name: "Stop", exact: true }).click(); await expect(page.getByText(/Response cancelled/)).toBeVisible(); await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible(); release();
});

import { test, expect, type Page } from "@playwright/test";
import { createStreamFixture } from "./stream-server";
import { CONCIERGE_DAILY_QUOTA_MESSAGE } from "../../app/_ai/concierge-error-messages";

let stream: Awaited<ReturnType<typeof createStreamFixture>>;
test.beforeEach(async ({ page }) => {
  stream = await createStreamFixture();
  await page.route("**/api/ai/concierge", (route) => route.continue({ url: stream.url }));
});
test.afterEach(async () => { await stream.close(); });

async function ask(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /AI concierge/i }).click();
  await page.getByLabel("Message the AI concierge").fill("2 guests for two nights");
  await page.getByRole("button", { name: "Send", exact: true }).click();
}
const output = {
  kind: "cabin-search", startDate: "2027-01-10", endDate: "2027-01-12", numNights: 2,
  numGuests: 2, currency: "USD", maxTotalPrice: 1200, facts: [], sourceIds: [],
  recommendations: [{ cabinId: 1, name: "Cabin 001", maxCapacity: 4, image: "/icon.png",
    description: "A quiet cabin.", regularPrice: 300, discount: 50, nightlyPrice: 250,
    startDate: "2027-01-10", endDate: "2027-01-12", numNights: 2, numGuests: 2,
    totalPrice: 500, withinBudget: true, preferences: [], facts: [], sourceIds: [] }],
};
async function partial() {
  await stream.write({ type: "start", messageId: "fixture-answer" }, { type: "start-step" }, { type: "tool-input-start", toolCallId: "cabins", toolName: "searchAvailableCabins" }, { type: "tool-input-available", toolCallId: "cabins", toolName: "searchAvailableCabins", input: {} });
}
async function cardAndText() {
  await stream.write({ type: "tool-output-available", toolCallId: "cabins", output }, { type: "finish-step" }, { type: "start-step" }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "Cabin found. Checking the hotel policy." }, { type: "tool-input-start", toolCallId: "policy", toolName: "getHotelPolicy" }, { type: "tool-input-available", toolCallId: "policy", toolName: "getHotelPolicy", input: {} });
}

for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`daily quota after a card shows the actual reason without an immediate retry on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let requests = 0;
    page.on("request", request => { if (request.url().includes("/api/ai/concierge")) requests += 1; });
    await ask(page); await partial();
    await stream.write({ type: "tool-output-available", toolCallId: "cabins", output }, { type: "finish-step" }, { type: "start-step" }, { type: "error", errorText: `${CONCIERGE_DAILY_QUOTA_MESSAGE} Reference: 00000000-0000-4000-8000-000000000005` });
    await stream.finish();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toContainText(CONCIERGE_DAILY_QUOTA_MESSAGE);
    await expect(dialog.getByRole("alert")).not.toContainText("Check your connection");
    await expect(dialog.getByText("Cabin 001", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Retry last request" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    expect(requests).toBe(1);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/concierge-daily-quota-${viewport.name}.png`, fullPage: true });
  });

  test(`real streaming cards and text survive Stop on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await ask(page); await partial();
    await expect(page.getByText("Checking live data…")).toBeVisible();
    await cardAndText();
    await expect(page.getByText("Cabin 001", { exact: true })).toBeVisible();
    await expect(page.getByText("Cabin found. Checking the hotel policy.", { exact: false })).toBeVisible();
    await expect(page.getByText("Checking live data…")).toBeVisible();
    await page.screenshot({ path: `output/playwright/dual-streaming-${viewport.name}.png`, fullPage: true });
    expect(await page.getByRole("dialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Stopped before a result was received")).toBeVisible();
    await expect(page.getByText("Cabin found. Checking the hotel policy.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    await stream.disconnected;
  });
}

test("a second text-only preference reply keeps the first answer and adds no new cards", async ({ page }) => {
  await ask(page); await partial();
  await stream.write({ type: "tool-output-available", toolCallId: "cabins", output }, { type: "text-start", id: "first" }, { type: "text-delta", id: "first", delta: "Here is your quiet cabin." }, { type: "text-end", id: "first" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" });
  await stream.finish();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  const followup = await createStreamFixture();
  try {
    await page.route("**/api/ai/concierge", route => route.continue({ url: followup.url }));
    await page.getByLabel("Message the AI concierge").fill("我偏好哪些类型的房屋");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await followup.write({ type: "start", messageId: "fixture-followup" }, { type: "start-step" }, { type: "text-start", id: "recap" }, { type: "text-delta", id: "recap", delta: "你提到希望安静一些。" });
    await followup.write({ type: "text-end", id: "recap" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" });
    await followup.finish();
    await expect(page.getByText("你提到希望安静一些。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    await expect(page.getByText("Cabin 001", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Here is your quiet cabin.", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
  } finally { await followup.close(); }
});

test("network loss preserves cards and text and stops pending tools", async ({ page }) => {
  await ask(page); await partial(); await cardAndText();
  await expect(page.getByText("Cabin found. Checking the hotel policy.", { exact: false })).toBeVisible();
  await stream.disconnect();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Received text and cards are kept");
  await expect(page.getByText("Cabin 001", { exact: true })).toBeVisible();
  await expect(page.getByText("Cabin found. Checking the hotel policy.", { exact: false })).toBeVisible();
  await expect(page.getByText("Stopped before a result was received")).toBeVisible();
});

test("streaming does not pull a reader down and Jump to latest resumes following", async ({ page }) => {
  await ask(page);
  await stream.write({ type: "start", messageId: "fixture-answer" }, { type: "start-step" }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: Array.from({ length: 65 }, (_, index) => `Cabin detail ${index}.`).join("\n\n") });
  const content = page.getByLabel("Concierge conversation");
  await expect.poll(() => content.evaluate((element) => element.scrollHeight)).toBeGreaterThan(1500);
  await content.evaluate((element) => { element.scrollTop = 40; element.dispatchEvent(new Event("scroll")); });
  await stream.write({ type: "text-delta", id: "text", delta: "\n\nLatest streamed finding." });
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
  expect(await content.evaluate((element) => element.scrollTop)).toBe(40);
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect.poll(() => content.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(80);
  await stream.write({ type: "text-end", id: "text" }, { type: "finish-step" }, { type: "finish", finishReason: "stop" });
  await stream.finish();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
});

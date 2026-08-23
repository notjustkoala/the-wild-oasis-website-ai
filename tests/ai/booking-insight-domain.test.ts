import { createHash } from "node:crypto";

import { MockLanguageModelV4 } from "ai/test";

import { generateBookingInsight } from "@/app/_ai/booking-insight-generator";
import {
  createBookingInsightSourceHash,
  prepareObservationForModel,
  redactObservation,
} from "@/app/_ai/booking-insight-privacy";
import { bookingInsightSchema } from "@/app/_ai/schemas/booking-insight";

const validInsight = {
  summary: "Prepare a safe gluten-free arrival.",
  riskTags: ["food-allergy"] as const,
  severity: "high" as const,
  actionItems: ["Confirm allergen-safe preparation with the kitchen."],
  confidence: 0.94,
};

function usage() {
  return {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 20, text: 20, reasoning: undefined },
  };
}

describe("booking insight schema and privacy boundary", () => {
  it("accepts the operational contract and rejects invalid tags, confidence and actions", () => {
    expect(bookingInsightSchema.parse(validInsight)).toEqual(validInsight);
    expect(() =>
      bookingInsightSchema.parse({ ...validInsight, riskTags: ["vip"] })
    ).toThrow();
    expect(() =>
      bookingInsightSchema.parse({ ...validInsight, confidence: 1.01 })
    ).toThrow();
    expect(() =>
      bookingInsightSchema.parse({ ...validInsight, actionItems: ["  "] })
    ).toThrow();
  });

  it("redacts emails, phones and long identifiers without erasing ordinary words", () => {
    const redacted = redactObservation(
      "Anniversary celebration. Reach me at guest@example.com, +86 138 0013 8000, ID AB1234567890."
    );
    expect(redacted).toContain("Anniversary celebration");
    expect(redacted).toContain("[email redacted]");
    expect(redacted).toContain("[phone redacted]");
    expect(redacted).toContain("[identifier redacted]");
    expect(redacted).not.toMatch(/guest@example\.com|138 0013 8000|AB1234567890/);
  });

  it("redacts a labelled guest name before any model request", () => {
    const prepared = prepareObservationForModel(
      "Guest name Alice Smith; gluten allergy"
    );
    expect(prepared).toEqual({
      ok: true,
      value: "Guest name [name redacted]; gluten allergy",
    });
    expect(JSON.stringify(prepared)).not.toContain("Alice Smith");
  });

  it("fails closed when possible personal data cannot be isolated safely", () => {
    expect(
      prepareObservationForModel("Please welcome Alice Smith; gluten allergy")
    ).toEqual({ ok: false, reason: "suspected-pii" });
    expect(
      prepareObservationForModel("Passport: X1234567; late arrival")
    ).toEqual({ ok: false, reason: "suspected-pii" });
    expect(
      prepareObservationForModel("姓名：张三，对花生过敏")
    ).toEqual({ ok: false, reason: "suspected-pii" });
    expect(
      prepareObservationForModel("张三对花生过敏")
    ).toEqual({ ok: false, reason: "suspected-pii" });
    expect(
      prepareObservationForModel("Жанна Петрова просит поздний заезд")
    ).toEqual({ ok: false, reason: "suspected-pii" });
    expect(prepareObservationForModel("需要无麸质早餐")).toEqual({
      ok: true,
      value: "需要无麸质早餐",
    });
  });

  it("creates a deterministic source hash that changes with model or prompt", () => {
    const input = {
      observation: "  Late   arrival ",
      model: "gemini-test",
      promptVersion: "v1",
    };
    const first = createBookingInsightSourceHash(input);
    expect(first).toHaveLength(64);
    expect(first).toBe(
      createBookingInsightSourceHash({ ...input, observation: "Late arrival" })
    );
    expect(first).not.toBe(
      createBookingInsightSourceHash({ ...input, model: "gemini-next" })
    );
    expect(first).not.toBe(createHash("sha256").update(input.observation).digest("hex"));
  });

  it("uses an AI SDK mock model for validated structured output", async () => {
    let providerRequest = "";
    const model = new MockLanguageModelV4({
      doGenerate: async (request) => {
        providerRequest = JSON.stringify(request);
        return {
          content: [{ type: "text", text: JSON.stringify(validInsight) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    await expect(
      generateBookingInsight("Gluten allergy; [email redacted]", { model })
    ).resolves.toEqual(validInsight);
    expect(providerRequest).toContain("Gluten allergy");
    expect(providerRequest).toContain("[email redacted]");
    expect(providerRequest).not.toContain("guest@example.com");
  });
});

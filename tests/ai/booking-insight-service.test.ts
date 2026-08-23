import { analyzeBookingInsight } from "@/app/_ai/booking-insight-service";
import type {
  BookingInsightRecord,
  BookingInsightRepository,
  ClaimResult,
} from "@/app/_ai/booking-insight-repository";
import type { BookingInsight } from "@/app/_ai/schemas/booking-insight";
import { createCurrentBookingInsightIdentity } from "@/app/_ai/booking-insight-identity";
import {
  BookingInsightStaleError,
  getBookingInsightView,
  reviewBookingInsight,
} from "@/app/_ai/booking-insight-view";

const result: BookingInsight = {
  summary: "Coordinate a late arrival.",
  riskTags: ["late-arrival"],
  severity: "medium",
  actionItems: ["Confirm after-hours check-in instructions."],
  confidence: 0.9,
};

function record(overrides: Partial<BookingInsightRecord> = {}): BookingInsightRecord {
  return {
    booking_id: 12,
    result,
    model: "gemini-test",
    prompt_version: "booking-risk-v1",
    source_hash: "a".repeat(64),
    status: "succeeded",
    generation_token: null,
    attempt_count: 1,
    failure_code: null,
    created_at: "2026-08-15T00:00:00Z",
    updated_at: "2026-08-15T00:00:00Z",
    reviewed_at: null,
    reviewer_feedback: null,
    ...overrides,
  };
}

function repository(claimResult: ClaimResult, observation = "Late at 23:30") {
  return {
    getBookingObservation: vi.fn().mockResolvedValue(observation),
    getInsight: vi.fn(),
    claim: vi.fn().mockImplementation(async (input) => ({
      ...claimResult,
      model: input.model,
      prompt_version: input.promptVersion,
      source_hash: input.sourceHash,
    })),
    complete: vi.fn().mockResolvedValue(record()),
    fail: vi.fn().mockResolvedValue(record({ status: "failed", result: null })),
    saveFeedback: vi.fn(),
  } satisfies BookingInsightRepository;
}

describe("booking insight idempotent service", () => {
  const env = {
    NODE_ENV: "test",
    AI_PROVIDER: "google",
    GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
    AI_BOOKING_INSIGHT_MODEL: "gemini-test",
  } as NodeJS.ProcessEnv;

  it("returns a cache hit without another model call", async () => {
    const repo = repository({ ...record(), claim_state: "cached" });
    const generate = vi.fn();
    const view = await analyzeBookingInsight(
      repo,
      12,
      { force: false },
      { env, generate }
    );
    expect(view.state).toBe("cached");
    expect(generate).not.toHaveBeenCalled();
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it("does not duplicate generation while an atomic claim is pending", async () => {
    const repo = repository({
      ...record({ status: "pending", result: null, generation_token: "token" }),
      claim_state: "pending",
    });
    const generate = vi.fn();
    await expect(
      analyzeBookingInsight(repo, 12, { force: true }, { env, generate })
    ).resolves.toMatchObject({ state: "pending" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("sends only redacted observation to the generator and completes by token", async () => {
    const repo = repository(
      {
        ...record({ status: "pending", result: null, generation_token: "claim-1" }),
        claim_state: "claimed",
      },
      "Guest name Alice Smith; late arrival. guest@example.com +86 138 0013 8000 AB1234567890"
    );
    const generate = vi.fn().mockResolvedValue(result);
    await analyzeBookingInsight(repo, 12, { force: false }, { env, generate });
    const modelInput = generate.mock.calls[0][0];
    expect(modelInput).toContain("[email redacted]");
    expect(modelInput).toContain("[name redacted]");
    expect(modelInput).not.toMatch(
      /Alice Smith|guest@example\.com|138 0013 8000|AB1234567890/
    );
    expect(repo.complete).toHaveBeenCalledWith({
      bookingId: 12,
      generationToken: "claim-1",
      result,
    });
  });

  it("records a safe failed state without mutating the booking flow", async () => {
    const repo = repository({
      ...record({ status: "pending", result: null, generation_token: "claim-2" }),
      claim_state: "claimed",
    });
    const view = await analyzeBookingInsight(
      repo,
      12,
      { force: false },
      { env, generate: vi.fn().mockRejectedValue(new Error("secret provider body")) }
    );
    expect(view.state).toBe("failed");
    expect(repo.fail).toHaveBeenCalledWith({
      bookingId: 12,
      generationToken: "claim-2",
      failureCode: "provider-unavailable",
    });
    expect(repo.getBookingObservation).toHaveBeenCalledTimes(1);
    expect(Object.keys(repo)).not.toContain("updateBooking");
  });

  it("returns empty without claiming or generating", async () => {
    const repo = repository({ ...record(), claim_state: "cached" }, "   ");
    const generate = vi.fn();
    await expect(
      analyzeBookingInsight(repo, 12, { force: false }, { env, generate })
    ).resolves.toEqual({ state: "empty", insight: null });
    expect(repo.claim).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips the model and claim when possible PII cannot be safely isolated", async () => {
    const repo = repository(
      { ...record(), claim_state: "cached" },
      "Please welcome Alice Smith; gluten allergy"
    );
    const generate = vi.fn();
    await expect(
      analyzeBookingInsight(repo, 12, { force: false }, { env, generate })
    ).resolves.toEqual({ state: "manual-review", insight: null });
    expect(repo.claim).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("marks cached results stale when observation, model, or prompt changes", async () => {
    const observation = "Late arrival at 23:30";
    const identity = createCurrentBookingInsightIdentity(observation, env);
    const repo = repository(
      { ...record(), claim_state: "cached" },
      observation
    );
    repo.getInsight.mockResolvedValue(
      record({
        model: identity.model,
        prompt_version: identity.promptVersion,
        source_hash: identity.sourceHash,
      })
    );

    await expect(getBookingInsightView(repo, 12, { env })).resolves.toMatchObject({
      state: "cached",
    });
    repo.getBookingObservation.mockResolvedValueOnce("Pet arriving at 23:30");
    await expect(getBookingInsightView(repo, 12, { env })).resolves.toMatchObject({
      state: "stale",
    });
    await expect(
      getBookingInsightView(repo, 12, {
        env: { ...env, AI_BOOKING_INSIGHT_MODEL: "gemini-next" },
      })
    ).resolves.toMatchObject({ state: "stale" });
    await expect(
      getBookingInsightView(repo, 12, { env, promptVersion: "booking-risk-v2" })
    ).resolves.toMatchObject({ state: "stale" });
  });

  it.each([
    ["observation", "Pet arriving at 23:30", env, undefined],
    ["model", "Late arrival at 23:30", { ...env, AI_BOOKING_INSIGHT_MODEL: "gemini-next" }, undefined],
    ["prompt", "Late arrival at 23:30", env, "booking-risk-v2"],
  ])("refuses feedback when the current %s identity is stale", async (_kind, currentObservation, currentEnv, promptVersion) => {
    const baselineObservation = "Late arrival at 23:30";
    const baselineIdentity = createCurrentBookingInsightIdentity(
      baselineObservation,
      env
    );
    const existing = record({
      model: baselineIdentity.model,
      prompt_version: baselineIdentity.promptVersion,
      source_hash: baselineIdentity.sourceHash,
      reviewer_feedback: null,
    });
    const saveFeedback = vi.fn();
    const repo = {
      getBookingObservation: vi.fn().mockResolvedValue(currentObservation),
      getInsight: vi.fn().mockResolvedValue(existing),
      claim: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      saveFeedback,
    } satisfies BookingInsightRepository;

    await expect(
      reviewBookingInsight(
        repo,
        12,
        { verdict: "correct" },
        { env: currentEnv, promptVersion }
      )
    ).rejects.toBeInstanceOf(BookingInsightStaleError);
    expect(saveFeedback).not.toHaveBeenCalled();
    expect(existing.reviewer_feedback).toBeNull();
    expect(existing.result).toBe(result);
  });

  it("retries a persisted failure and then completes successfully", async () => {
    let stored: BookingInsightRecord | null = null;
    let attempt = 0;
    const repo: BookingInsightRepository = {
      getBookingObservation: vi.fn().mockResolvedValue("Late arrival at 23:30"),
      getInsight: vi.fn(async () => stored),
      claim: vi.fn(async (input) => {
        attempt += 1;
        stored = record({
          result: null,
          model: input.model,
          prompt_version: input.promptVersion,
          source_hash: input.sourceHash,
          status: "pending",
          generation_token: `claim-${attempt}`,
          attempt_count: attempt,
        });
        return { ...stored, claim_state: "claimed" as const };
      }),
      complete: vi.fn(async (input) => {
        stored = record({
          model: stored!.model,
          prompt_version: stored!.prompt_version,
          source_hash: stored!.source_hash,
          result: input.result,
          status: "succeeded",
          generation_token: null,
          attempt_count: attempt,
        });
        return stored;
      }),
      fail: vi.fn(async (input) => {
        stored = record({
          result: null,
          model: stored!.model,
          prompt_version: stored!.prompt_version,
          source_hash: stored!.source_hash,
          status: "failed",
          generation_token: null,
          attempt_count: attempt,
          failure_code: input.failureCode,
        });
        return stored;
      }),
      saveFeedback: vi.fn(),
    };
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce(result);

    await expect(
      analyzeBookingInsight(repo, 12, { force: false }, { env, generate })
    ).resolves.toMatchObject({ state: "failed" });
    await expect(
      analyzeBookingInsight(repo, 12, { force: false }, { env, generate })
    ).resolves.toMatchObject({ state: "cached", insight: { result } });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(repo.fail).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledTimes(1);
  });

  it("allows only one generator for two concurrent requests", async () => {
    let stored: BookingInsightRecord | null = null;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repo: BookingInsightRepository = {
      getBookingObservation: vi.fn().mockResolvedValue("Late arrival at 23:30"),
      getInsight: vi.fn(async () => stored),
      claim: vi.fn(async (input) => {
        if (stored?.status === "pending") {
          return { ...stored, claim_state: "pending" as const };
        }
        stored = record({
          result: null,
          model: input.model,
          prompt_version: input.promptVersion,
          source_hash: input.sourceHash,
          status: "pending",
          generation_token: "only-claim",
        });
        return { ...stored, claim_state: "claimed" as const };
      }),
      complete: vi.fn(async (input) => {
        stored = record({
          model: stored!.model,
          prompt_version: stored!.prompt_version,
          source_hash: stored!.source_hash,
          result: input.result,
        });
        return stored;
      }),
      fail: vi.fn(),
      saveFeedback: vi.fn(),
    };
    const generate = vi.fn(async () => {
      await gate;
      return result;
    });

    const first = analyzeBookingInsight(repo, 12, { force: false }, { env, generate });
    const second = analyzeBookingInsight(repo, 12, { force: false }, { env, generate });
    await vi.waitFor(() => expect(repo.claim).toHaveBeenCalledTimes(2));
    expect(generate).toHaveBeenCalledTimes(1);
    release();
    const views = await Promise.all([first, second]);
    expect(views.map((view) => view.state).sort()).toEqual(["cached", "pending"]);
  });
});

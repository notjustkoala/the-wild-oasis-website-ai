import { createBookingInsightRouteHandlers } from "@/app/_ai/booking-insight-route";
import { authorizeBookingInsightAdmin } from "@/app/_ai/booking-insight-auth";
import { MAX_BOOKING_INSIGHT_BODY_BYTES } from "@/app/_ai/booking-insight-request";
import type { BookingInsightRepository } from "@/app/_ai/booking-insight-repository";
import { BookingInsightStaleError } from "@/app/_ai/booking-insight-view";
import { createCurrentBookingInsightIdentity } from "@/app/_ai/booking-insight-identity";

const repository = {} as never;
const authorized = vi.fn().mockResolvedValue({
  ok: true,
  client: {},
  user: { id: "admin" },
});

function request(
  method: string,
  body?: unknown,
  origin = "http://127.0.0.1:5173"
) {
  return new Request("http://127.0.0.1:3000/api/ai/booking-insight/12", {
    method,
    headers: {
      Origin: origin,
      Authorization: "Bearer test",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("booking insight route boundary", () => {
  const context = { params: { bookingId: "12" } };

  it("rejects an untrusted origin before authentication", async () => {
    const authorize = vi.fn();
    const handlers = createBookingInsightRouteHandlers({
      env: { NODE_ENV: "test" },
      authorize: authorize as never,
    });
    const response = await handlers.GET(request("GET", undefined, "https://evil.test"), context);
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("answers strict development preflight without wildcard CORS", () => {
    const handlers = createBookingInsightRouteHandlers({ env: { NODE_ENV: "test" } });
    const response = handlers.OPTIONS(request("OPTIONS"));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:5173"
    );
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("allows only the explicitly configured production admin origin", () => {
    const handlers = createBookingInsightRouteHandlers({
      env: {
        NODE_ENV: "production",
        AI_ADMIN_ORIGIN: "https://admin.example.com",
      },
    });
    const response = handlers.OPTIONS(
      request("OPTIONS", undefined, "https://admin.example.com")
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://admin.example.com"
    );
    expect(
      handlers.OPTIONS(request("OPTIONS", undefined, "https://other.example.com"))
        .status
    ).toBe(403);
  });

  it("returns authorization failures without touching a repository", async () => {
    const repositoryFactory = vi.fn();
    const handlers = createBookingInsightRouteHandlers({
      env: { NODE_ENV: "test" },
      authorize: vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        message: "Administrator access is required.",
      }) as never,
      repository: repositoryFactory,
    });
    const response = await handlers.GET(request("GET"), context);
    expect(response.status).toBe(403);
    expect(repositoryFactory).not.toHaveBeenCalled();
  });

  it("requires a bearer token before constructing a Supabase client", async () => {
    const createClient = vi.fn();
    await expect(
      authorizeBookingInsightAdmin(
        new Request("http://localhost/api/ai/booking-insight/12"),
        { env: { NODE_ENV: "test" }, createClient: createClient as never }
      )
    ).resolves.toMatchObject({ ok: false, status: 401 });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses verified app_metadata and rejects user_metadata role escalation", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "guest",
          app_metadata: {},
          user_metadata: { role: "admin" },
        },
      },
      error: null,
    });
    const createClient = vi.fn(() => ({ auth: { getUser } }));
    const result = await authorizeBookingInsightAdmin(
      new Request("http://localhost/api/ai/booking-insight/12", {
        headers: { Authorization: "Bearer verified-token" },
      }),
      {
        env: {
          NODE_ENV: "test",
          SUPABASE_URL: "https://dev.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "test-publishable",
        },
        createClient: createClient as never,
      }
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(getUser).toHaveBeenCalledWith("verified-token");
  });

  it("rejects an invalid bearer token returned by Supabase auth", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: "invalid token details" },
    });
    const result = await authorizeBookingInsightAdmin(
      new Request("http://localhost/api/ai/booking-insight/12", {
        headers: { Authorization: "Bearer invalid-token" },
      }),
      {
        env: {
          NODE_ENV: "test",
          SUPABASE_URL: "https://dev.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "test-publishable",
        },
        createClient: vi.fn(() => ({ auth: { getUser } })) as never,
      }
    );
    expect(result).toEqual({
      ok: false,
      status: 401,
      message: "The session is invalid or expired.",
    });
    expect(JSON.stringify(result)).not.toContain("invalid token details");
  });

  it("validates POST and returns pending without leaking the generation token", async () => {
    const analyze = vi.fn().mockResolvedValue({
      state: "pending",
      insight: {
        booking_id: 12,
        result: null,
        model: "gemini-test",
        prompt_version: "v1",
        source_hash: "a".repeat(64),
        status: "pending",
        generation_token: "private-token",
        attempt_count: 1,
        failure_code: null,
        created_at: "now",
        updated_at: "now",
        reviewed_at: null,
        reviewer_feedback: null,
      },
    });
    const handlers = createBookingInsightRouteHandlers({
      env: { NODE_ENV: "test" },
      authorize: authorized as never,
      repository: () => repository,
      analyze,
    });
    const response = await handlers.POST(request("POST", { force: false }), context);
    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain("private-token");
    expect(analyze).toHaveBeenCalledWith(repository, 12, { force: false }, expect.any(Object));
  });

  it("validates employee feedback before calling the review service", async () => {
    const review = vi.fn();
    const handlers = createBookingInsightRouteHandlers({
      env: { NODE_ENV: "test" },
      authorize: authorized as never,
      repository: () => repository,
      review,
    });
    const response = await handlers.PATCH(
      request("PATCH", { verdict: "wrong-value", note: "x" }),
      context
    );
    expect(response.status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });

  it("rejects a declared body over 8KB before acquiring its stream reader", async () => {
    const getReader = vi.fn();
    const analyze = vi.fn();
    const handlers = createBookingInsightRouteHandlers({
      env: { NODE_ENV: "test" },
      authorize: authorized as never,
      repository: () => repository,
      analyze,
    });
    const oversized = {
      headers: new Headers({
        Origin: "http://127.0.0.1:5173",
        Authorization: "Bearer test",
        "Content-Type": "application/json",
        "Content-Length": String(MAX_BOOKING_INSIGHT_BODY_BYTES + 1),
      }),
      body: { getReader },
    } as unknown as Request;
    const response = await handlers.POST(oversized, context);
    expect(response.status).toBe(413);
    expect(getReader).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("cancels a real streamed body as soon as raw bytes exceed 8KB", async () => {
    const cancel = vi.fn();
    const chunks = [
      new Uint8Array(MAX_BOOKING_INSIGHT_BODY_BYTES),
      new Uint8Array(1),
    ];
    let index = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (index < chunks.length) controller.enqueue(chunks[index++]);
          else controller.close();
        },
        cancel,
      },
      { highWaterMark: 0 }
    );
    const streamed = new Request(
      "http://127.0.0.1:3000/api/ai/booking-insight/12",
      {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:5173",
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }
    );
    const handlers = createBookingInsightRouteHandlers({
      env: { NODE_ENV: "test" },
      authorize: authorized as never,
      repository: () => repository,
      analyze: vi.fn(),
    });
    const response = await handlers.POST(streamed, context);
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("persists PATCH feedback while retaining the original AI result", async () => {
    const routeEnv = {
      NODE_ENV: "test",
      AI_PROVIDER: "google",
      GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
      AI_BOOKING_INSIGHT_MODEL: "gemini-test",
    } as NodeJS.ProcessEnv;
    const identity = createCurrentBookingInsightIdentity(
      "Pet arriving.",
      routeEnv
    );
    const originalResult = {
      summary: "Prepare a pet arrival.",
      riskTags: ["pet"],
      severity: "medium",
      actionItems: ["Prepare the pet kit."],
      confidence: 0.88,
    } as const;
    let stored = {
      booking_id: 12,
      result: originalResult,
      model: identity.model,
      prompt_version: identity.promptVersion,
      source_hash: identity.sourceHash,
      status: "succeeded" as const,
      generation_token: null,
      attempt_count: 1,
      failure_code: null,
      created_at: "now",
      updated_at: "now",
      reviewed_at: null as string | null,
      reviewer_feedback: null as null | {
        verdict: "partially-correct";
        correctedTags: ["pet", "other"];
        note: string;
      },
    };
    const originalReference = stored.result;
    const repo = {
      getBookingObservation: vi.fn().mockResolvedValue("Pet arriving."),
      getInsight: vi.fn(async () => stored),
      claim: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      saveFeedback: vi.fn(async (_bookingId, feedback) => {
        stored = {
          ...stored,
          reviewed_at: "reviewed-now",
          reviewer_feedback: feedback as typeof stored.reviewer_feedback,
        };
        return stored;
      }),
    } as unknown as BookingInsightRepository;
    const handlers = createBookingInsightRouteHandlers({
      env: routeEnv,
      authorize: authorized as never,
      repository: () => repo,
    });
    const feedback = {
      verdict: "partially-correct",
      correctedTags: ["pet", "other"],
      note: "Pet tag is correct; add a manual note.",
    } as const;
    const response = await handlers.PATCH(request("PATCH", feedback), context);
    expect(response.status).toBe(200);
    expect(repo.saveFeedback).toHaveBeenCalledWith(12, feedback);
    expect(stored.result).toBe(originalReference);
    await expect(response.json()).resolves.toMatchObject({
      state: "reviewed",
      insight: { result: originalResult, reviewerFeedback: feedback },
    });
  });

  it("returns a clear conflict when PATCH feedback targets a stale insight", async () => {
    const handlers = createBookingInsightRouteHandlers({
      env: { NODE_ENV: "test" },
      authorize: authorized as never,
      repository: () => repository,
      review: vi.fn().mockRejectedValue(new BookingInsightStaleError()),
    });
    const response = await handlers.PATCH(
      request("PATCH", { verdict: "correct" }),
      context
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "This insight is stale because the booking observation, model, or prompt changed. Refresh and regenerate it before reviewing.",
    });
  });
});

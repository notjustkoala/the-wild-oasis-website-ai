import "server-only";

import { authorizeBookingInsightAdmin } from "@/app/_ai/booking-insight-auth";
import { bookingInsightCors } from "@/app/_ai/booking-insight-cors";
import {
  createBookingInsightRepository,
  type BookingInsightRecord,
  type BookingInsightRepository,
} from "@/app/_ai/booking-insight-repository";
import { readBoundedBookingInsightJson } from "@/app/_ai/booking-insight-request";
import { analyzeBookingInsight } from "@/app/_ai/booking-insight-service";
import {
  bookingInsightFeedbackSchema,
  bookingInsightPostBodySchema,
} from "@/app/_ai/schemas/booking-insight";
import {
  BookingInsightNotReviewableError,
  BookingInsightStaleError,
  BookingNotFoundError,
  getBookingInsightView,
  reviewBookingInsight,
  type BookingInsightView,
} from "@/app/_ai/booking-insight-view";

type RouteContext = { params: { bookingId: string } };

type RouteDependencies = {
  env?: NodeJS.ProcessEnv;
  authorize?: typeof authorizeBookingInsightAdmin;
  repository?: (client: unknown) => BookingInsightRepository;
  analyze?: typeof analyzeBookingInsight;
  getView?: typeof getBookingInsightView;
  review?: typeof reviewBookingInsight;
};

function publicRecord(record: BookingInsightRecord | null) {
  if (!record) return null;
  return {
    result: record.result,
    model: record.model,
    promptVersion: record.prompt_version,
    sourceHash: record.source_hash,
    status: record.status,
    attemptCount: record.attempt_count,
    failureCode: record.failure_code,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    reviewedAt: record.reviewed_at,
    reviewerFeedback: record.reviewer_feedback,
  };
}

function publicView(view: BookingInsightView) {
  return { state: view.state, insight: publicRecord(view.insight) };
}

function bookingIdFrom(context: RouteContext): number | null {
  if (!/^\d+$/.test(context.params.bookingId)) return null;
  const bookingId = Number(context.params.bookingId);
  return Number.isSafeInteger(bookingId) && bookingId > 0 ? bookingId : null;
}

function json(body: unknown, status: number, headers: Headers) {
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers });
}

function errorResponse(error: unknown, headers: Headers) {
  if (error instanceof BookingNotFoundError) {
    return json({ error: "Booking not found." }, 404, headers);
  }
  if (error instanceof BookingInsightNotReviewableError) {
    return json(
      { error: "A completed insight is required before review." },
      409,
      headers
    );
  }
  if (error instanceof BookingInsightStaleError) {
    return json(
      {
        error:
          "This insight is stale because the booking observation, model, or prompt changed. Refresh and regenerate it before reviewing.",
      },
      409,
      headers
    );
  }
  return json(
    { error: "The booking insight service is temporarily unavailable." },
    503,
    headers
  );
}

export function createBookingInsightRouteHandlers(
  dependencies: RouteDependencies = {}
) {
  const env = dependencies.env ?? process.env;
  const authorize = dependencies.authorize ?? authorizeBookingInsightAdmin;
  const repositoryFactory =
    dependencies.repository ??
    ((client) => createBookingInsightRepository(client as never));
  const analyze = dependencies.analyze ?? analyzeBookingInsight;
  const getView = dependencies.getView ?? getBookingInsightView;
  const review = dependencies.review ?? reviewBookingInsight;

  async function prepare(request: Request, context: RouteContext) {
    const cors = bookingInsightCors(request, env);
    if (!cors.ok) {
      return {
        ok: false,
        response: json(
          { error: "Origin is not allowed." },
          403,
          cors.headers
        ),
      } as const;
    }
    const bookingId = bookingIdFrom(context);
    if (!bookingId) {
      return {
        ok: false,
        response: json(
          { error: "Booking ID is invalid." },
          400,
          cors.headers
        ),
      } as const;
    }
    const authorization = await authorize(request, { env });
    if (!authorization.ok) {
      return {
        ok: false,
        response: json(
          { error: authorization.message },
          authorization.status,
          cors.headers
        ),
      } as const;
    }
    return {
      ok: true,
      bookingId,
      repository: repositoryFactory(authorization.client),
      headers: cors.headers,
    } as const;
  }

  async function GET(request: Request, context: RouteContext): Promise<Response> {
    const prepared = await prepare(request, context);
    if (!prepared.ok) return prepared.response;
    try {
      const view = await getView(prepared.repository, prepared.bookingId, {
        env,
      });
      return json(publicView(view), 200, prepared.headers);
    } catch (error) {
      return errorResponse(error, prepared.headers);
    }
  }

  async function POST(request: Request, context: RouteContext): Promise<Response> {
    const prepared = await prepare(request, context);
    if (!prepared.ok) return prepared.response;
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      return json(
        { error: "Content-Type must be application/json." },
        415,
        prepared.headers
      );
    }
    const parsed = await readBoundedBookingInsightJson(request);
    if (!parsed.ok) {
      return json({ error: parsed.message }, parsed.status, prepared.headers);
    }
    const body = bookingInsightPostBodySchema.safeParse(parsed.body);
    if (!body.success) {
      return json(
        { error: "Request body is invalid." },
        400,
        prepared.headers
      );
    }
    try {
      const view = await analyze(
        prepared.repository,
        prepared.bookingId,
        body.data,
        { env }
      );
      const status =
        view.state === "pending" ? 202 : view.state === "failed" ? 503 : 200;
      return json(publicView(view), status, prepared.headers);
    } catch (error) {
      return errorResponse(error, prepared.headers);
    }
  }

  async function PATCH(request: Request, context: RouteContext): Promise<Response> {
    const prepared = await prepare(request, context);
    if (!prepared.ok) return prepared.response;
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      return json(
        { error: "Content-Type must be application/json." },
        415,
        prepared.headers
      );
    }
    const parsed = await readBoundedBookingInsightJson(request);
    if (!parsed.ok) {
      return json({ error: parsed.message }, parsed.status, prepared.headers);
    }
    const feedback = bookingInsightFeedbackSchema.safeParse(parsed.body);
    if (!feedback.success) {
      return json({ error: "Feedback is invalid." }, 400, prepared.headers);
    }
    try {
      const view = await review(
        prepared.repository,
        prepared.bookingId,
        feedback.data,
        { env }
      );
      return json(publicView(view), 200, prepared.headers);
    } catch (error) {
      return errorResponse(error, prepared.headers);
    }
  }

  function OPTIONS(request: Request): Response {
    const cors = bookingInsightCors(request, env);
    if (!cors.ok) {
      return json({ error: "Origin is not allowed." }, 403, cors.headers);
    }
    return new Response(null, { status: 204, headers: cors.headers });
  }

  return { GET, POST, PATCH, OPTIONS };
}

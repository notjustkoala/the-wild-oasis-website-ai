import "server-only";

const DEVELOPMENT_ADMIN_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

export type BookingInsightCorsResult =
  | { ok: true; headers: Headers }
  | { ok: false; status: 403; headers: Headers };

function allowedOrigins(env: NodeJS.ProcessEnv): Set<string> {
  const configured = env.AI_ADMIN_ORIGIN?.trim();
  const origins = new Set<string>();
  if (configured) {
    for (const value of configured.split(",")) {
      try {
        origins.add(new URL(value.trim()).origin);
      } catch {
        // Invalid configuration never becomes an allowed origin.
      }
    }
  }
  if (env.NODE_ENV !== "production") {
    for (const origin of DEVELOPMENT_ADMIN_ORIGINS) origins.add(origin);
  }
  return origins;
}

export function bookingInsightCors(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): BookingInsightCorsResult {
  const headers = new Headers({ Vary: "Origin" });
  const origin = request.headers.get("origin");
  if (!origin) return { ok: true, headers };

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return { ok: false, status: 403, headers };
  }
  if (normalizedOrigin !== origin || !allowedOrigins(env).has(normalizedOrigin)) {
    return { ok: false, status: 403, headers };
  }

  headers.set("Access-Control-Allow-Origin", normalizedOrigin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Max-Age", "600");
  headers.set("Access-Control-Expose-Headers", "X-AI-Trace-Id, X-AI-Feedback-Token, Retry-After");
  return { ok: true, headers };
}

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createPrivilegedSupabaseClient } from "@/app/_lib/supabase-server";
import type { Surface } from "./run";

function secret(env = process.env) { return env.AI_OBSERVABILITY_SECRET || env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function digest(value: string, key: string) { return createHmac("sha256", key).update(value).digest("hex"); }
export function issueFeedbackToken(traceId: string, surface: Surface, env = process.env, now = Date.now()) {
  const key = secret(env); if (!key || !uuid.test(traceId)) return null;
  const body = `${traceId}.${surface}.${Math.floor(now / 1000) + 3600}`;
  return `${body}.${digest(`feedback:${body}`, key)}`;
}
export function verifyFeedbackToken(token: string, traceId: string, env = process.env, now = Date.now()): Surface | null {
  const key = secret(env); if (!key || token.length > 256 || !uuid.test(traceId)) return null;
  const [id, surface, expires, signature, extra] = token.split(".");
  if (extra || id !== traceId || !["concierge", "operations", "booking-insight"].includes(surface) || !/^\d{10}$/.test(expires) || Number(expires) <= now / 1000 || Number(expires) > now / 1000 + 3600 || !/^[0-9a-f]{64}$/.test(signature ?? "")) return null;
  const expected = digest(`feedback:${id}.${surface}.${expires}`, key);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) ? surface as Surface : null;
}
export function traceHeaders(traceId: string, surface: Surface) {
  const headers = new Headers({ "X-AI-Trace-Id": traceId, "Cache-Control": "no-store" });
  const token = issueFeedbackToken(traceId, surface); if (token) headers.set("X-AI-Feedback-Token", token);
  return headers;
}
export async function enforceRateLimit(surface: Surface, actorId?: string, dependencies: { env?: NodeJS.ProcessEnv; consume?: (bucket: string, limit: number) => Promise<{ allowed: boolean; retry_after: number }> } = {}) {
  const key = secret(dependencies.env); if (!key) return { ok: false as const, status: 503, retryAfter: 0 };
  // Anonymous traffic shares one bucket. Never trust arbitrary forwarded IPs.
  const bucket = `${surface}:${digest(actorId ? `actor:${actorId}` : "anonymous-shared", key)}`;
  try {
    const consume = dependencies.consume ?? (async (key: string, limit: number) => {
      const client = createPrivilegedSupabaseClient();
      const { data, error } = await client.rpc("consume_ai_rate_limit", { p_bucket: key, p_limit: limit, p_window_seconds: 60 }).abortSignal(AbortSignal.timeout(1_500));
      if (error || !data) throw new Error("Unavailable");
      return data as { allowed: boolean; retry_after: number };
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([consume(bucket, surface === "concierge" ? 20 : 30), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Unavailable")), 1_600); })]);
      if (typeof result.allowed !== "boolean" || !Number.isFinite(result.retry_after)) throw new Error("Invalid response");
      return result.allowed ? { ok: true as const } : { ok: false as const, status: 429, retryAfter: Math.max(1, Math.ceil(result.retry_after)) };
    } finally { if (timer) clearTimeout(timer); }
  } catch { return { ok: false as const, status: 503, retryAfter: 0 }; }
}

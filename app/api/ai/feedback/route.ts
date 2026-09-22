import { z } from "zod";
import { operationsCors } from "@/app/_ai/operations-cors";
import { verifyFeedbackToken } from "@/app/_ai/observability/access";
import { createPrivilegedSupabaseClient } from "@/app/_lib/supabase-server";
const schema = z.object({ traceId: z.string().uuid(), token: z.string().max(256), rating: z.enum(["helpful", "not-helpful"]) }).strict();
export async function POST(request: Request) {
  const cors = operationsCors(request);
  const sameOrigin = !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin;
  const headers = sameOrigin ? new Headers() : cors.headers;
  headers.set("Cache-Control", "no-store");
  if (!sameOrigin && !cors.ok) return Response.json({ error: "Origin is not allowed." }, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON is required." }, { status: 415, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Invalid feedback." }, { status: 400, headers });
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1024) { await reader.cancel(); return Response.json({ error: "Feedback is too large." }, { status: 413, headers }); } chunks.push(value); } } catch { return Response.json({ error: "Invalid feedback." }, { status: 400, headers }); }
  let parsed; try { parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { return Response.json({ error: "Invalid feedback." }, { status: 400, headers }); }
  if (!parsed.success) return Response.json({ error: "Invalid feedback." }, { status: 400, headers });
  const { traceId, token, rating } = parsed.data;
  const surface = verifyFeedbackToken(token, traceId);
  if (!surface) return Response.json({ error: "Feedback permission expired or is invalid." }, { status: 403, headers });
  if (surface !== "concierge" && !cors.ok) return Response.json({ error: "Origin is not allowed." }, { status: 403, headers });
  try {
    const client = createPrivilegedSupabaseClient();
    const { data, error } = await client.from("ai_runs").select("trace_id,surface").eq("trace_id", traceId).eq("surface", surface).abortSignal(AbortSignal.timeout(1_500)).maybeSingle();
    if (error) throw new Error("Unavailable");
    if (!data) return Response.json({ error: "This response is not ready for feedback." }, { status: 409, headers });
    const saved = await client.from("ai_feedback").upsert({ trace_id: traceId, rating, updated_at: new Date().toISOString() }, { onConflict: "trace_id" }).abortSignal(AbortSignal.timeout(1_500));
    if (saved.error) throw new Error("Unavailable");
    return Response.json({ saved: true }, { headers });
  } catch { return Response.json({ error: "Feedback could not be saved. Please retry." }, { status: 503, headers }); }
}
export function OPTIONS(request: Request) { const cors = operationsCors(request); return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers }); }

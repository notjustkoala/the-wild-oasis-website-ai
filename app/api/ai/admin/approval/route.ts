import { z } from "zod";

import { authorizeOperationsStaff } from "@/app/_ai/operations-auth";
import { decideOperationsApproval } from "@/app/_ai/operations-approval";
import { operationsCors } from "@/app/_ai/operations-cors";
import { readBoundedConciergeJson } from "@/app/_ai/concierge-request";

const bodySchema = z.object({
  approvalId: z.string().uuid(),
  action: z.enum(["approve", "reject", "submit", "cancel", "acknowledge"]),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/),
  reason: z.string().trim().max(500).default(""),
}).strict().refine(body => body.action !== "reject" || body.reason.length > 0, "Rejection reason required.");

const filters = z.object({
  scope: z.enum(["mine", "inbox"]).default("mine"),
  status: z.enum(["all", "draft", "pending", "executed", "rejected", "cancelled", "conflict", "history"]).default("all"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

function json(body: unknown, status: number, headers: Headers) {
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  const cors = operationsCors(request);
  if (!cors.ok) return json({ error: "Origin is not allowed." }, 403, cors.headers);
  const authorization = await authorizeOperationsStaff(request);
  if (!authorization.ok) return json({ error: authorization.message }, authorization.status, cors.headers);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "Content-Type must be application/json." }, 415, cors.headers);
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 4_000) return json({ error: "The request is too large." }, 413, cors.headers);
  const bounded = await readBoundedConciergeJson(request);
  if (!bounded.ok) return json({ error: bounded.message }, bounded.status, cors.headers);
  const bodyBytes = new TextEncoder().encode(JSON.stringify(bounded.body)).byteLength;
  if (bodyBytes > 4_000) return json({ error: "The request is too large." }, 413, cors.headers);
  const parsed = bodySchema.safeParse(bounded.body);
  if (!parsed.success) return json({ error: "Approval request is invalid." }, 400, cors.headers);
  if (["approve", "reject"].includes(parsed.data.action) && authorization.role !== "admin") return json({ error: "Administrator access is required to review requests." }, 403, cors.headers);
  if (request.headers.get("x-idempotency-key") !== parsed.data.idempotencyKey) {
    return json({ error: "The idempotency key must be supplied in the request header and body." }, 400, cors.headers);
  }
  try {
    const result = await decideOperationsApproval({
      client: authorization.client,
      actorId: authorization.user.id,
      ...parsed.data,
    });
    return json({ approval: result }, 200, cors.headers);
  } catch (error) {
    const message = error instanceof Error && /required|not found|actionable/i.test(error.message)
      ? error.message
      : "Approval decision could not be recorded.";
    return json({ error: message }, 409, cors.headers);
  }
}

export async function GET(request: Request) {
  const cors = operationsCors(request);
  if (!cors.ok) return json({ error: "Origin is not allowed." }, 403, cors.headers);
  const authorization = await authorizeOperationsStaff(request);
  if (!authorization.ok) return json({ error: authorization.message }, authorization.status, cors.headers);
  const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return json({ error: "Approval filters are invalid." }, 400, cors.headers);
  if (parsed.data.scope === "inbox" && authorization.role !== "admin") return json({ error: "Administrator access is required." }, 403, cors.headers);
  try {
    const { data, error } = await authorization.client.rpc("list_booking_ai_approvals", {
      p_scope: parsed.data.scope, p_status: parsed.data.status, p_page: parsed.data.page, p_page_size: parsed.data.pageSize,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (error || !data) throw new Error("Unavailable");
    return json(data, 200, cors.headers);
  } catch { return json({ error: "Approval requests could not be loaded. Please retry." }, 503, cors.headers); }
}

export function OPTIONS(request: Request) {
  const cors = operationsCors(request);
  return cors.ok
    ? new Response(null, { status: 204, headers: cors.headers })
    : json({ error: "Origin is not allowed." }, 403, cors.headers);
}

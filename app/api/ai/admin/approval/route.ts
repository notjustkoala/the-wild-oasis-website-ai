import { z } from "zod";

import { authorizeOperationsStaff } from "@/app/_ai/operations-auth";
import { decideOperationsApproval } from "@/app/_ai/operations-approval";
import { operationsCors } from "@/app/_ai/operations-cors";
import { readBoundedConciergeJson } from "@/app/_ai/concierge-request";

const bodySchema = z.object({
  approvalId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/),
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

export function OPTIONS(request: Request) {
  const cors = operationsCors(request);
  return cors.ok
    ? new Response(null, { status: 204, headers: cors.headers })
    : json({ error: "Origin is not allowed." }, 403, cors.headers);
}

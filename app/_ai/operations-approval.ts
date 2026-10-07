import "server-only";

import type { ApprovalProposal } from "@/app/_ai/operations-types";

type ApprovalClient = { from: (table: string) => unknown };

export async function createOperationsApproval({
  client,
  actorId,
  bookingId,
  note,
  now = () => new Date(),
}: {
  client: ApprovalClient;
  actorId: string;
  bookingId: number;
  note: string;
  now?: () => Date;
}): Promise<ApprovalProposal> {
  const { data, error } = await (client as any).rpc("create_booking_ai_approval", {
    p_booking_id: bookingId,
    p_note: note.trim(),
  });
  if (error || !data) throw new Error("Approval request could not be created.");
  const row = Array.isArray(data) ? data[0] : data;
  return {
    kind: "internal-note-approval",
    approvalId: String(row.approval_id),
    bookingId: Number(row.booking_id),
    note: String(row.note),
    status: row.status === "draft" ? "draft" : "pending",
    sourceIds: [`booking:${Number(row.booking_id)}`, `approval:${String(row.approval_id)}`].sort(),
    facts: [`Draft created ${now().toISOString()}. Submit after reviewing; administrator approval is required before writing.`],
    truncated: false,
  };
}

export async function decideOperationsApproval({
  client,
  actorId,
  approvalId,
  action,
  idempotencyKey,
  reason = "",
}: {
  client: ApprovalClient;
  actorId: string;
  approvalId: string;
  action: "approve" | "reject" | "submit" | "cancel" | "acknowledge";
  idempotencyKey: string;
  reason?: string;
}) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new Error("A valid idempotency key is required.");
  }
  const { data, error } = await (client.from("booking_ai_approvals") as any)
    .select("id, booking_id, note, status, actor_id")
    .eq("id", approvalId)
    .maybeSingle();
  if (error || !data) throw new Error("Approval request not found.");
  if (["submit", "cancel", "acknowledge"].includes(action) && data.actor_id !== actorId) throw new Error("Approval request not found.");
  // All state/role/idempotency decisions are made by the locked DB transition,
  // including repeated decisions. Do not short-circuit authorization in TS.
  const { data: result, error: rpcError } = await (client as any).rpc("transition_booking_ai_approval", {
    p_approval_id: approvalId,
    p_action: action,
    p_idempotency_key: idempotencyKey,
    p_reason: reason,
  });
  if (rpcError || !result) throw new Error("Approval decision could not be recorded.");
  return result;
}

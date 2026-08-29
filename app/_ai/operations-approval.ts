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
    status: "pending",
    sourceIds: [`booking:${Number(row.booking_id)}`, `approval:${String(row.approval_id)}`].sort(),
    facts: [`Draft created ${now().toISOString()}. Employee approval is required before writing.`],
    truncated: false,
  };
}

export async function decideOperationsApproval({
  client,
  actorId,
  approvalId,
  action,
  idempotencyKey,
}: {
  client: ApprovalClient;
  actorId: string;
  approvalId: string;
  action: "approve" | "reject";
  idempotencyKey: string;
}) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new Error("A valid idempotency key is required.");
  }
  const { data, error } = await (client.from("booking_ai_approvals") as any)
    .select("id, booking_id, note, status, actor_id")
    .eq("id", approvalId)
    .eq("actor_id", actorId)
    .maybeSingle();
  if (error || !data) throw new Error("Approval request not found.");
  if (data.status === "rejected") {
    return { id: String(data.id), bookingId: Number(data.booking_id), status: "rejected", repeated: true };
  }
  if (data.status === "executed") {
    return { id: String(data.id), bookingId: Number(data.booking_id), status: "executed", repeated: true };
  }
  if (data.status !== "pending") throw new Error("Approval request is no longer actionable.");
  const { data: result, error: rpcError } = await (client as any).rpc("decide_booking_internal_note", {
    p_approval_id: approvalId,
    p_action: action,
    p_idempotency_key: idempotencyKey,
  });
  if (rpcError || !result) throw new Error("Approval decision could not be recorded.");
  return result;
}

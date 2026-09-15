import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createOperationsApproval, decideOperationsApproval } from "@/app/_ai/operations-approval";

describe("operations approval boundary", () => {
  it("creates a pending approval and never claims that it executed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { approval_id: "a", booking_id: 7, note: "Call guest", status: "pending" }, error: null });
    const proposal = await createOperationsApproval({ client: { from: vi.fn(), rpc } as never, actorId: "actor", bookingId: 7, note: " Call guest " });
    expect(rpc).toHaveBeenCalledWith("create_booking_ai_approval", { p_booking_id: 7, p_note: "Call guest" });
    expect(proposal.status).toBe("pending");
  });

  it("does not retry a rejected approval", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "approval", status: "rejected" }, error: null });
    const row = { id: "approval", booking_id: 7, note: "Call guest", status: "pending", actor_id: "actor" };
    const builder: Record<string, any> = { select: vi.fn(() => builder), eq: vi.fn(() => builder), maybeSingle: vi.fn(() => Promise.resolve({ data: row, error: null })) };
    const client = { from: vi.fn(() => builder), rpc } as never;
    await decideOperationsApproval({ client, actorId: "actor", approvalId: "approval", action: "reject", idempotencyKey: "reject-key-123456" });
    row.status = "rejected";
    const repeated = await decideOperationsApproval({ client, actorId: "actor", approvalId: "approval", action: "reject", idempotencyKey: "reject-key-654321" });
    expect(repeated).toEqual({ id: "approval", bookingId: 7, status: "rejected", repeated: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("executes an approved note once and returns a repeated result on duplicate submit", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "approval", bookingId: 7, status: "executed", repeated: false }, error: null });
    const row = { id: "approval", booking_id: 7, note: "Call guest", status: "pending", actor_id: "actor" };
    const builder: Record<string, any> = { select: vi.fn(() => builder), eq: vi.fn(() => builder), maybeSingle: vi.fn(() => Promise.resolve({ data: row, error: null })) };
    const client = { from: vi.fn(() => builder), rpc } as never;
    const first = await decideOperationsApproval({ client, actorId: "actor", approvalId: "approval", action: "approve", idempotencyKey: "approve-key-123456" });
    expect(first).toMatchObject({ status: "executed", repeated: false });
    row.status = "executed";
    const repeated = await decideOperationsApproval({ client, actorId: "actor", approvalId: "approval", action: "approve", idempotencyKey: "approve-key-123456" });
    expect(repeated).toEqual({ id: "approval", bookingId: 7, status: "executed", repeated: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("migration exposes only the internal note as the approval write", () => {
    const source = readFileSync(resolve(process.cwd(), "supabase/migrations/20260824162537_ai_operations_copilot.sql"), "utf8");
    const bookingUpdate = source.match(/update public\.bookings[\s\S]*?where id = v_approval\.booking_id;/i)?.[0] ?? "";
    expect(bookingUpdate).toMatch(/set \"internalNote\"/i);
    expect(bookingUpdate).not.toMatch(/set\s+\"?(?:status|isPaid|totalPrice|startDate|endDate|cabinId|guestId)\"?\s*=/i);
    expect(source).toMatch(/'approved'/i);
    expect(source).toMatch(/'rejected'/i);
    expect(source).toMatch(/'executed'/i);
    expect(source).toMatch(/bookings_staff_select/);
    expect(source).not.toMatch(/bookings_staff_admin_all/);
  });

  it("maps approval actions to valid audit events in the append-only fix", () => {
    const source = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826151933_fix_booking_ai_reject_audit_event.sql"), "utf8");
    expect(source).toMatch(/create or replace function public\.decide_booking_internal_note/i);
    expect(source).toMatch(/when 'approve' then 'approved'/i);
    expect(source).toMatch(/when 'reject' then 'rejected'/i);
    expect(source).not.toMatch(/p_action\s*\|\|\s*'d'/i);
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path\s*=\s*''/i);
    expect(source).toMatch(/actor_id\s*=\s*\(select auth\.uid\(\)\)/i);
    const bookingUpdate = source.match(/update public\.bookings[\s\S]*?where id = v_approval\.booking_id;/i)?.[0] ?? "";
    expect(bookingUpdate).toMatch(/set "internalNote"/i);
    expect(bookingUpdate).not.toMatch(/set\s+"?(?:status|isPaid|totalPrice|startDate|endDate|cabinId|guestId)"?\s*=/i);
    expect(source).toMatch(/revoke all on function public\.decide_booking_internal_note/i);
    expect(source).toMatch(/grant execute on function public\.decide_booking_internal_note[\s\S]*to authenticated/i);
  });
});

import {readFileSync} from "node:fs";
const sql=readFileSync("supabase/migrations/20261007121303_approval_workflow.sql","utf8");
it("keeps client table mutation denied and rechecks the current trusted application role",()=>{
 expect(sql).toMatch(/select raw_app_meta_data->>'role'.*from auth\.users/);
 expect(sql).not.toMatch(/raw_user_meta_data\s*->>\s*'role'/);
 expect(sql).toMatch(/p_action in \('approve','reject'\) and v_role <> 'admin'/);
 expect(sql).toMatch(/p_action in \('submit','cancel','acknowledge'\) and v_approval.actor_id<>/);
 expect(sql).not.toMatch(/grant\s+(?:all|insert|update|delete).*on\s+(?:table\s+)?public\.booking_ai_approvals/i);
});
it("locks the approval and booking and protects the exact original note snapshot",()=>{
 expect(sql).toMatch(/where id=p_approval_id for update/);
 expect(sql).toMatch(/where id=v_approval.booking_id for update/);
 expect(sql).toMatch(/v_current is distinct from v_approval.base_note/);
 expect(sql).toMatch(/v_status:='conflict'/);
 const updates=sql.match(/update public\.bookings[\s\S]*?;/gi)??[];
 expect(updates).toHaveLength(1);expect(updates[0]).toMatch(/set "internalNote"=v_approval.note/);
 expect(updates[0]).not.toMatch(/status|isPaid|totalPrice|startDate|endDate|cabinId|guestId/);
});
it("closes the previous self-approval RPC and records rejection reasons/unread outcomes",()=>{
 const legacy=sql.slice(sql.indexOf("create or replace function public.decide_booking_internal_note"),sql.indexOf("create function public.list_booking_ai_approvals"));
 expect(legacy).toMatch(/security invoker/);expect(legacy).toMatch(/transition_booking_ai_approval/);
 expect(sql).toMatch(/rejection reason required/);expect(sql).toMatch(/seen_at=null/);
 expect(sql).toMatch(/set seen_at=coalesce\(seen_at,now\(\)\)/);
});

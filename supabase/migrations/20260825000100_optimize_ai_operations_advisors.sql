begin;

-- Advisor fix for Feature 03. This is an append-only migration: the already
-- applied 20260823000100 migration remains immutable.

-- Foreign-key covering indexes keep approval/audit joins and parent deletes
-- from requiring a full scan of the child tables.
create index if not exists booking_ai_approvals_booking_id_idx
  on public.booking_ai_approvals (booking_id);
create index if not exists booking_ai_audit_log_actor_id_idx
  on public.booking_ai_audit_log (actor_id);
create index if not exists booking_ai_audit_log_approval_id_idx
  on public.booking_ai_audit_log (approval_id);

-- Replace the original broad admin policy plus the staff SELECT policy with a
-- single authenticated SELECT policy. Admin INSERT/UPDATE/DELETE privileges
-- remain explicit and are not accidentally broadened to staff.
drop policy if exists bookings_admin_all on public.bookings;
drop policy if exists bookings_staff_select on public.bookings;
drop policy if exists bookings_admin_insert on public.bookings;
drop policy if exists bookings_admin_update on public.bookings;
drop policy if exists bookings_admin_delete on public.bookings;

create policy bookings_staff_select
  on public.bookings for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('admin', 'staff'));

create policy bookings_admin_insert
  on public.bookings for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create policy bookings_admin_update
  on public.bookings for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create policy bookings_admin_delete
  on public.bookings for delete to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- Normalize Feature 03 RLS expressions so auth.jwt() is evaluated once per
-- statement, as recommended by Supabase's RLS performance guidance.
drop policy if exists booking_ai_approvals_staff_select on public.booking_ai_approvals;
create policy booking_ai_approvals_staff_select
  on public.booking_ai_approvals for select to authenticated
  using (
    actor_id = (select auth.uid())
    and ((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('admin', 'staff')
  );

drop policy if exists booking_ai_audit_staff_select on public.booking_ai_audit_log;
create policy booking_ai_audit_staff_select
  on public.booking_ai_audit_log for select to authenticated
  using (
    actor_id = (select auth.uid())
    and ((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('admin', 'staff')
  );

-- Keep the constrained SECURITY DEFINER exception for atomic approval/audit/
-- booking-note transitions. The applied function bodies already enforce an
-- authenticated admin/staff app_metadata role, auth.uid ownership, action
-- and idempotency allow-lists, and only update bookings.internalNote.
alter function public.create_booking_ai_approval(bigint, text)
  set search_path = '';
alter function public.decide_booking_internal_note(uuid, text, text)
  set search_path = '';

revoke all on function public.create_booking_ai_approval(bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.decide_booking_internal_note(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking_ai_approval(bigint, text) to authenticated;
grant execute on function public.decide_booking_internal_note(uuid, text, text) to authenticated;

commit;

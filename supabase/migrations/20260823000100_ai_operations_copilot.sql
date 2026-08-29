begin;

-- Feature 03 keeps the existing customer-facing booking fields immutable. The
-- only booking field writable by the approval function is this staff-only note.
alter table public.bookings
  add column if not exists "internalNote" text not null default '';
alter table public.bookings
  add constraint bookings_internal_note_length
  check (char_length("internalNote") <= 500);

drop policy if exists bookings_admin_all on public.bookings;
create policy bookings_admin_all
  on public.bookings for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy bookings_staff_select
  on public.bookings for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'staff'));

create table public.booking_ai_approvals (
  id uuid primary key default gen_random_uuid(),
  booking_id bigint not null references public.bookings(id) on delete cascade,
  note text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending',
  idempotency_key text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz,
  constraint booking_ai_approvals_status_valid
    check (status in ('pending', 'approved', 'rejected', 'executed')),
  constraint booking_ai_approvals_note_valid
    check (char_length(btrim(note)) between 1 and 500),
  constraint booking_ai_approvals_idempotency_valid
    check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  constraint booking_ai_approvals_decision_dates_valid
    check (status = 'pending' or decided_at is not null),
  constraint booking_ai_approvals_execution_date_valid
    check (status <> 'executed' or executed_at is not null)
);

create unique index booking_ai_approvals_idempotency_idx
  on public.booking_ai_approvals (idempotency_key)
  where idempotency_key is not null;
create index booking_ai_approvals_actor_status_idx
  on public.booking_ai_approvals (actor_id, status, created_at desc);

create table public.booking_ai_audit_log (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.booking_ai_approvals(id) on delete cascade,
  booking_id bigint not null references public.bookings(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint booking_ai_audit_event_valid
    check (event in ('drafted', 'approved', 'rejected', 'executed')),
  constraint booking_ai_audit_payload_valid
    check (jsonb_typeof(payload) = 'object')
);
create index booking_ai_audit_booking_created_idx
  on public.booking_ai_audit_log (booking_id, created_at desc);

alter table public.booking_ai_approvals enable row level security;
alter table public.booking_ai_audit_log enable row level security;
revoke all privileges on table public.booking_ai_approvals, public.booking_ai_audit_log
  from public, anon, authenticated, service_role;
grant select on table public.booking_ai_approvals, public.booking_ai_audit_log to authenticated;

create policy booking_ai_approvals_staff_select
  on public.booking_ai_approvals for select to authenticated
  using (
    actor_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'staff')
  );
create policy booking_ai_audit_staff_select
  on public.booking_ai_audit_log for select to authenticated
  using (
    actor_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'staff')
  );

create or replace function public.create_booking_ai_approval(
  p_booking_id bigint,
  p_note text
)
returns table (approval_id uuid, booking_id bigint, note text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null
    or (select auth.jwt() -> 'app_metadata' ->> 'role') not in ('admin', 'staff') then
    raise exception 'not authorized';
  end if;
  if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then
    raise exception 'invalid note';
  end if;
  if not exists (select 1 from public.bookings where id = p_booking_id) then
    raise exception 'booking not found';
  end if;
  insert into public.booking_ai_approvals (booking_id, note, actor_id)
  values (p_booking_id, btrim(p_note), (select auth.uid()))
  returning id into v_id;
  insert into public.booking_ai_audit_log (approval_id, booking_id, actor_id, event, payload)
  values (v_id, p_booking_id, (select auth.uid()), 'drafted',
    jsonb_build_object('note_length', char_length(btrim(p_note))));
  return query select v_id, p_booking_id, btrim(p_note), 'pending';
end;
$$;

create or replace function public.decide_booking_internal_note(
  p_approval_id uuid,
  p_action text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.booking_ai_approvals%rowtype;
  v_existing public.booking_ai_approvals%rowtype;
begin
  if (select auth.uid()) is null
    or (select auth.jwt() -> 'app_metadata' ->> 'role') not in ('admin', 'staff') then
    raise exception 'not authorized';
  end if;
  if p_action not in ('approve', 'reject')
    or p_idempotency_key is null
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' then
    raise exception 'invalid decision';
  end if;
  select * into v_approval
    from public.booking_ai_approvals
    where id = p_approval_id and actor_id = (select auth.uid())
    for update;
  if v_approval.id is null then raise exception 'approval not found'; end if;
  if v_approval.status = 'rejected' then
    return jsonb_build_object('id', v_approval.id, 'bookingId', v_approval.booking_id, 'status', 'rejected', 'repeated', true);
  end if;
  if v_approval.status = 'executed' then
    return jsonb_build_object('id', v_approval.id, 'bookingId', v_approval.booking_id, 'status', 'executed', 'repeated', true);
  end if;
  select * into v_existing
    from public.booking_ai_approvals
    where idempotency_key = p_idempotency_key and id <> p_approval_id;
  if v_existing.id is not null then raise exception 'idempotency key already used'; end if;

  update public.booking_ai_approvals
    set idempotency_key = p_idempotency_key, decided_at = now(),
        status = case when p_action = 'reject' then 'rejected' else 'approved' end
    where id = p_approval_id;
  insert into public.booking_ai_audit_log (approval_id, booking_id, actor_id, event, payload, idempotency_key)
  values (v_approval.id, v_approval.booking_id, (select auth.uid()), p_action || 'd',
    jsonb_build_object('note_length', char_length(v_approval.note)), p_idempotency_key);
  if p_action = 'reject' then
    return jsonb_build_object('id', v_approval.id, 'bookingId', v_approval.booking_id, 'status', 'rejected', 'repeated', false);
  end if;

  -- This is the only booking mutation in the feature: no core field is copied
  -- from the request, and only internalNote is updated.
  update public.bookings set "internalNote" = v_approval.note
    where id = v_approval.booking_id;
  update public.booking_ai_approvals set status = 'executed', executed_at = now()
    where id = v_approval.id;
  insert into public.booking_ai_audit_log (approval_id, booking_id, actor_id, event, payload, idempotency_key)
  values (v_approval.id, v_approval.booking_id, (select auth.uid()), 'executed',
    jsonb_build_object('field', 'internalNote', 'note_length', char_length(v_approval.note)), p_idempotency_key);
  return jsonb_build_object('id', v_approval.id, 'bookingId', v_approval.booking_id, 'status', 'executed', 'repeated', false);
end;
$$;

revoke all on function public.create_booking_ai_approval(bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.decide_booking_internal_note(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking_ai_approval(bigint, text) to authenticated;
grant execute on function public.decide_booking_internal_note(uuid, text, text) to authenticated;

commit;

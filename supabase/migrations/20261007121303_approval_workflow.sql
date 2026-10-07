begin;

alter table public.booking_ai_approvals
  add column base_note text,
  add column submitted_at timestamptz,
  add column decided_by uuid references auth.users(id) on delete restrict,
  add column decision_reason text not null default '',
  add column cancelled_at timestamptz,
  add column seen_at timestamptz;
alter table public.booking_ai_approvals drop constraint booking_ai_approvals_status_valid;
alter table public.booking_ai_approvals add constraint booking_ai_approvals_status_valid
  check (status in ('draft','pending','approved','executed','rejected','cancelled','conflict'));
alter table public.booking_ai_approvals drop constraint booking_ai_approvals_decision_dates_valid;
alter table public.booking_ai_approvals add constraint booking_ai_approvals_decision_dates_valid
  check (status in ('draft','pending') or decided_at is not null);
alter table public.booking_ai_approvals add constraint booking_ai_approvals_reason_length check (char_length(decision_reason) <= 500);
alter table public.booking_ai_approvals alter column status set default 'draft';
-- Existing submitted requests remain submitted; completed history is untouched.
update public.booking_ai_approvals a set base_note = b."internalNote", submitted_at = a.created_at
  from public.bookings b where a.booking_id = b.id and a.status = 'pending';
alter table public.booking_ai_audit_log drop constraint booking_ai_audit_event_valid;
alter table public.booking_ai_audit_log add constraint booking_ai_audit_event_valid
  check (event in ('drafted','submitted','approved','rejected','executed','cancelled','conflict'));
create index booking_ai_approvals_status_submitted_idx on public.booking_ai_approvals(status, submitted_at desc, id);
create index booking_ai_approvals_unseen_idx on public.booking_ai_approvals(actor_id, decided_at desc)
  where seen_at is null and status in ('executed','rejected','conflict');
create index booking_ai_approvals_decided_by_idx on public.booking_ai_approvals(decided_by);

drop policy booking_ai_approvals_staff_select on public.booking_ai_approvals;
create policy booking_ai_approvals_staff_select on public.booking_ai_approvals for select to authenticated using (
  ((select auth.jwt())->'app_metadata'->>'role') = 'admin' or
  (actor_id = (select auth.uid()) and ((select auth.jwt())->'app_metadata'->>'role') = 'staff')
);
drop policy booking_ai_audit_staff_select on public.booking_ai_audit_log;
create policy booking_ai_audit_staff_select on public.booking_ai_audit_log for select to authenticated using (
  ((select auth.jwt())->'app_metadata'->>'role') = 'admin' or
  (((select auth.jwt())->'app_metadata'->>'role') = 'staff' and exists (
    select 1 from public.booking_ai_approvals a where a.id = approval_id and a.actor_id = (select auth.uid())
  ))
);
-- No authenticated INSERT/UPDATE/DELETE grant. State changes use constrained RPCs.
create or replace function public.create_booking_ai_approval(p_booking_id bigint, p_note text)
returns table(approval_id uuid, booking_id bigint, note text, status text)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_role text; v_base text;
begin
  select raw_app_meta_data->>'role' into v_role from auth.users where id = (select auth.uid());
  if v_role is null or v_role not in ('admin','staff') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_note is null or char_length(btrim(p_note)) not between 1 and 500 then raise exception 'invalid note'; end if;
  select b."internalNote" into v_base from public.bookings b where b.id=p_booking_id for share;
  if not found then raise exception 'booking not found'; end if;
  insert into public.booking_ai_approvals(booking_id,note,actor_id,status,base_note)
    values(p_booking_id,btrim(p_note),(select auth.uid()),'draft',v_base) returning id into v_id;
  insert into public.booking_ai_audit_log(approval_id,booking_id,actor_id,event,payload)
    values(v_id,p_booking_id,(select auth.uid()),'drafted',jsonb_build_object('note_length',char_length(btrim(p_note))));
  return query select v_id,p_booking_id,btrim(p_note),'draft'::text;
end; $$;

-- Submit/withdraw belongs to the requester; approve/reject belongs to an administrator.
-- The booking write and both approval/execution audit events commit atomically.
create function public.transition_booking_ai_approval(p_approval_id uuid,p_action text,p_idempotency_key text,p_reason text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_approval public.booking_ai_approvals%rowtype; v_role text; v_current text; v_status text; v_event text;
begin
  select raw_app_meta_data->>'role' into v_role from auth.users where id=(select auth.uid());
  if v_role is null or v_role not in ('admin','staff') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_action is null or p_action not in ('submit','cancel','approve','reject','acknowledge') or
    p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' or
    p_reason is null or char_length(p_reason)>500 then raise exception 'invalid decision'; end if;
  if p_action in ('approve','reject') and v_role <> 'admin' then raise exception 'administrator access required' using errcode='42501'; end if;
  select * into v_approval from public.booking_ai_approvals where id=p_approval_id for update;
  if not found then raise exception 'approval not found'; end if;
  if p_action in ('submit','cancel','acknowledge') and v_approval.actor_id<>(select auth.uid()) then
    raise exception 'approval not found' using errcode='42501'; end if;
  if p_action='acknowledge' then
    if v_approval.status not in ('executed','rejected','conflict') then raise exception 'approval is not actionable'; end if;
    update public.booking_ai_approvals set seen_at=coalesce(seen_at,now()) where id=p_approval_id;
    return jsonb_build_object('id',v_approval.id,'bookingId',v_approval.booking_id,'status',v_approval.status,'repeated',v_approval.seen_at is not null);
  end if;
  if (p_action='submit' and v_approval.status='pending') or
    (p_action='cancel' and v_approval.status='cancelled') or
    (p_action='approve' and v_approval.status='executed') or
    (p_action='reject' and v_approval.status='rejected') then
    return jsonb_build_object('id',v_approval.id,'bookingId',v_approval.booking_id,'status',v_approval.status,'repeated',true);
  end if;
  if v_approval.status='conflict' and p_action='approve' then
    return jsonb_build_object('id',v_approval.id,'bookingId',v_approval.booking_id,'status','conflict','repeated',true);
  end if;
  if exists(select 1 from public.booking_ai_audit_log where idempotency_key=p_idempotency_key and approval_id<>p_approval_id) then raise exception 'idempotency key already used'; end if;
  if p_action='submit' then
    if v_approval.status<>'draft' then raise exception 'approval is no longer actionable'; end if;
    update public.booking_ai_approvals set status='pending',submitted_at=now() where id=p_approval_id;
    v_status:='pending'; v_event:='submitted';
  elsif p_action='cancel' then
    if v_approval.status not in ('draft','pending') then raise exception 'approval is no longer actionable'; end if;
    update public.booking_ai_approvals set status='cancelled',cancelled_at=now(),decided_at=now(),idempotency_key=p_idempotency_key where id=p_approval_id;
    v_status:='cancelled'; v_event:='cancelled';
  else
    if v_approval.status<>'pending' then raise exception 'approval is no longer actionable'; end if;
    if p_action='reject' and char_length(btrim(p_reason))=0 then raise exception 'rejection reason required'; end if;
    if p_action='approve' then
      select "internalNote" into v_current from public.bookings where id=v_approval.booking_id for update;
      if not found then raise exception 'booking not found'; end if;
      if v_current is distinct from v_approval.base_note then
        v_status:='conflict'; v_event:='conflict';
        p_reason:='The existing internal note changed. Create a new request using the latest booking.';
      else
        v_status:='executed'; v_event:='approved';
        update public.bookings set "internalNote"=v_approval.note where id=v_approval.booking_id;
      end if;
    else v_status:='rejected'; v_event:='rejected'; end if;
    update public.booking_ai_approvals set status=v_status,decided_at=now(),decided_by=(select auth.uid()),
      decision_reason=btrim(p_reason),executed_at=case when v_status='executed' then now() else null end,
      idempotency_key=p_idempotency_key,seen_at=null where id=p_approval_id;
  end if;
  insert into public.booking_ai_audit_log(approval_id,booking_id,actor_id,event,payload,idempotency_key)
    values(v_approval.id,v_approval.booking_id,(select auth.uid()),v_event,
      jsonb_build_object('note_length',char_length(v_approval.note),'reason_length',char_length(btrim(p_reason))),p_idempotency_key);
  if v_status='executed' then
    insert into public.booking_ai_audit_log(approval_id,booking_id,actor_id,event,payload,idempotency_key)
      values(v_approval.id,v_approval.booking_id,(select auth.uid()),'executed',jsonb_build_object('field','internalNote'),p_idempotency_key);
  end if;
  return jsonb_build_object('id',v_approval.id,'bookingId',v_approval.booking_id,'status',v_status,'repeated',false);
end; $$;

-- Close the previous direct staff-approval RPC too, not just its HTTP/UI entry.
create or replace function public.decide_booking_internal_note(p_approval_id uuid,p_action text,p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return public.transition_booking_ai_approval(p_approval_id,p_action,p_idempotency_key,'');
end; $$;

create function public.list_booking_ai_approvals(p_scope text default 'mine',p_status text default 'all',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_total integer; v_pending integer; v_unread integer; v_rows jsonb;
begin
  select raw_app_meta_data->>'role' into v_role from auth.users where id=(select auth.uid());
  if v_role is null or v_role not in ('admin','staff') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_scope is null or p_scope not in ('mine','inbox') or p_status is null or
    p_status not in ('all','draft','pending','executed','rejected','cancelled','conflict','history') or
    p_page is null or p_page not between 1 and 10000 or p_page_size is null or p_page_size not between 1 and 50 then raise exception 'invalid filters'; end if;
  if p_scope='inbox' and v_role<>'admin' then raise exception 'administrator access required' using errcode='42501'; end if;
  select count(*) into v_pending from public.booking_ai_approvals where status='pending' and (v_role='admin' or actor_id=(select auth.uid()));
  select count(*) into v_unread from public.booking_ai_approvals where actor_id=(select auth.uid()) and seen_at is null and status in ('executed','rejected','conflict');
  select count(*) into v_total from public.booking_ai_approvals a where
    (p_scope='mine' and a.actor_id=(select auth.uid()) or p_scope='inbox' and a.status<>'draft') and
    (p_status='all' or p_status=a.status or p_status='history' and a.status in ('executed','rejected','cancelled','conflict','approved'));
  select coalesce(jsonb_agg(row_data order by sort_date desc,id desc),'[]'::jsonb) into v_rows from (
    select a.id,coalesce(a.submitted_at,a.created_at) as sort_date,jsonb_build_object(
      'id',a.id,'bookingId',a.booking_id,'note',a.note,'baseNote',coalesce(a.base_note,''),'currentNote',b."internalNote",'status',a.status,
      'requesterName',left(coalesce(nullif(u.raw_user_meta_data->>'fullName',''),'Employee'),80),
      'reviewerName',case when a.decided_by is null then null else left(coalesce(nullif(d.raw_user_meta_data->>'fullName',''),'Administrator'),80) end,
      'isOwn',a.actor_id=(select auth.uid()),'createdAt',a.created_at,'submittedAt',a.submitted_at,'decidedAt',a.decided_at,
      'executedAt',a.executed_at,'seenAt',a.seen_at,'reason',a.decision_reason,'cabinName',coalesce(c.name,'Unavailable'),
      'startDate',to_char(b."startDate" at time zone 'UTC','YYYY-MM-DD'),'endDate',to_char(b."endDate" at time zone 'UTC','YYYY-MM-DD'),'numGuests',b."numGuests",
      'events',coalesce((select jsonb_agg(jsonb_build_object('event',l.event,'at',l.created_at) order by l.created_at,l.id)
        from public.booking_ai_audit_log l where l.approval_id=a.id),'[]'::jsonb)
    ) as row_data
    from public.booking_ai_approvals a join public.bookings b on b.id=a.booking_id
    left join public.cabins c on c.id=b."cabinId" left join auth.users u on u.id=a.actor_id left join auth.users d on d.id=a.decided_by
    where (p_scope='mine' and a.actor_id=(select auth.uid()) or p_scope='inbox' and a.status<>'draft') and
      (p_status='all' or p_status=a.status or p_status='history' and a.status in ('executed','rejected','cancelled','conflict','approved'))
    order by coalesce(a.submitted_at,a.created_at) desc,a.id desc limit p_page_size offset (p_page-1)*p_page_size
  ) page_rows;
  return jsonb_build_object('items',v_rows,'total',v_total,'pendingCount',v_pending,'unreadCount',v_unread,'page',p_page,'pageSize',p_page_size);
end; $$;

revoke all on function public.create_booking_ai_approval(bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.transition_booking_ai_approval(uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.decide_booking_internal_note(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.list_booking_ai_approvals(text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.create_booking_ai_approval(bigint,text),public.transition_booking_ai_approval(uuid,text,text,text),
  public.decide_booking_internal_note(uuid,text,text),public.list_booking_ai_approvals(text,text,integer,integer) to authenticated;

commit;

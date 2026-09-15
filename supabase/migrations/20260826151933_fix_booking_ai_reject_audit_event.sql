begin;

-- Append-only fix for the already-applied Feature 03 migration.
-- The previous function derived the invalid event 'rejectd'. The audit
-- constraint accepts 'rejected', so the failed insert rolled back the whole
-- rejection transaction. Keep the existing authorization, ownership,
-- idempotency, and internalNote-only mutation boundaries unchanged.
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
  values (v_approval.id, v_approval.booking_id, (select auth.uid()),
    case p_action
      when 'approve' then 'approved'
      when 'reject' then 'rejected'
    end,
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

revoke all on function public.decide_booking_internal_note(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_booking_internal_note(uuid, text, text) to authenticated;

commit;

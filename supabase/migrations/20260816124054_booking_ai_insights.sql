-- Traceable, idempotent AI operations briefing for one booking. The browser
-- reaches this table only as an authenticated employee and RLS remains the
-- authorization boundary for both direct queries and SECURITY INVOKER RPCs.
create table public.booking_ai_insights (
  booking_id bigint primary key
    references public.bookings(id) on update restrict on delete cascade,
  result jsonb,
  model text not null,
  prompt_version text not null,
  source_hash text not null,
  status text not null,
  generation_token uuid,
  attempt_count integer not null default 0,
  failure_code text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_feedback jsonb,
  constraint booking_ai_insights_status_valid
    check (status in ('pending', 'succeeded', 'failed')),
  constraint booking_ai_insights_source_hash_valid
    check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_ai_insights_attempt_count_valid
    check (attempt_count > 0),
  constraint booking_ai_insights_result_state_valid
    check (
      (status = 'succeeded' and result is not null and jsonb_typeof(result) = 'object')
      or (status in ('pending', 'failed'))
    ),
  constraint booking_ai_insights_failure_code_valid
    check (
      failure_code is null
      or failure_code in ('timeout', 'configuration', 'invalid-output', 'provider-unavailable')
    ),
  constraint booking_ai_insights_feedback_valid
    check (reviewer_feedback is null or jsonb_typeof(reviewer_feedback) = 'object'),
  constraint booking_ai_insights_history_valid
    check (jsonb_typeof(history) = 'array')
);

alter table public.booking_ai_insights enable row level security;

-- New Supabase projects may not auto-expose public tables. Grants and RLS are
-- deliberately explicit and least-privilege; no anon or DELETE access exists.
revoke all privileges on table public.booking_ai_insights
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.booking_ai_insights to authenticated;

create policy booking_ai_insights_admin_select
  on public.booking_ai_insights
  for select
  to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy booking_ai_insights_admin_insert
  on public.booking_ai_insights
  for insert
  to authenticated
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy booking_ai_insights_admin_update
  on public.booking_ai_insights
  for update
  to authenticated
  using (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- A single statement atomically inserts or conditionally reclaims a booking.
-- A fresh pending row is never reclaimed, including force requests. This makes
-- simultaneous requests share one model invocation while allowing stale jobs
-- and failed jobs to retry. The token protects against late old completions.
create or replace function public.claim_booking_ai_insight(
  p_booking_id bigint,
  p_source_hash text,
  p_model text,
  p_prompt_version text,
  p_force boolean default false
)
returns table (
  booking_id bigint,
  result jsonb,
  model text,
  prompt_version text,
  source_hash text,
  status text,
  generation_token uuid,
  attempt_count integer,
  failure_code text,
  history jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  reviewed_at timestamptz,
  reviewer_feedback jsonb,
  claim_state text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
  v_row public.booking_ai_insights%rowtype;
  v_claimed boolean := false;
begin
  insert into public.booking_ai_insights as existing (
    booking_id,
    result,
    model,
    prompt_version,
    source_hash,
    status,
    generation_token,
    attempt_count,
    failure_code
  ) values (
    p_booking_id,
    null,
    p_model,
    p_prompt_version,
    p_source_hash,
    'pending',
    v_token,
    1,
    null
  )
  on conflict on constraint booking_ai_insights_pkey do update
  set result = null,
      model = excluded.model,
      prompt_version = excluded.prompt_version,
      source_hash = excluded.source_hash,
      status = 'pending',
      generation_token = excluded.generation_token,
      attempt_count = existing.attempt_count + 1,
      failure_code = null,
      history = case
        when existing.status = 'succeeded' then
          existing.history || jsonb_build_array(jsonb_build_object(
            'result', existing.result,
            'model', existing.model,
            'prompt_version', existing.prompt_version,
            'source_hash', existing.source_hash,
            'reviewed_at', existing.reviewed_at,
            'reviewer_feedback', existing.reviewer_feedback,
            'archived_at', now()
          ))
        else existing.history
      end,
      reviewed_at = null,
      reviewer_feedback = null,
      updated_at = now()
  where
    existing.status = 'failed'
    or (
      existing.status = 'pending'
      and existing.updated_at < now() - interval '2 minutes'
    )
    or (
      existing.status = 'succeeded'
      and (
        p_force
        or existing.source_hash <> excluded.source_hash
        or existing.model <> excluded.model
        or existing.prompt_version <> excluded.prompt_version
      )
    )
  returning existing.* into v_row;

  if v_row.booking_id is not null then
    v_claimed := true;
  else
    select insight.* into v_row
    from public.booking_ai_insights as insight
    where insight.booking_id = p_booking_id;
  end if;

  return query select
    v_row.booking_id,
    v_row.result,
    v_row.model,
    v_row.prompt_version,
    v_row.source_hash,
    v_row.status,
    v_row.generation_token,
    v_row.attempt_count,
    v_row.failure_code,
    v_row.history,
    v_row.created_at,
    v_row.updated_at,
    v_row.reviewed_at,
    v_row.reviewer_feedback,
    case
      when v_claimed then 'claimed'
      when v_row.status = 'pending' then 'pending'
      when v_row.status = 'failed' then 'failed'
      else 'cached'
    end;
end;
$$;

create or replace function public.complete_booking_ai_insight(
  p_booking_id bigint,
  p_generation_token uuid,
  p_result jsonb
)
returns setof public.booking_ai_insights
language sql
security invoker
set search_path = ''
as $$
  update public.booking_ai_insights
  set result = p_result,
      status = 'succeeded',
      failure_code = null,
      generation_token = null,
      updated_at = now()
  where booking_id = p_booking_id
    and status = 'pending'
    and generation_token = p_generation_token
    and jsonb_typeof(p_result) = 'object'
  returning *;
$$;

create or replace function public.fail_booking_ai_insight(
  p_booking_id bigint,
  p_generation_token uuid,
  p_failure_code text
)
returns setof public.booking_ai_insights
language sql
security invoker
set search_path = ''
as $$
  update public.booking_ai_insights
  set status = 'failed',
      failure_code = case
        when p_failure_code in (
          'timeout', 'configuration', 'invalid-output', 'provider-unavailable'
        ) then p_failure_code
        else 'provider-unavailable'
      end,
      generation_token = null,
      updated_at = now()
  where booking_id = p_booking_id
    and status = 'pending'
    and generation_token = p_generation_token
  returning *;
$$;

revoke all on function public.claim_booking_ai_insight(bigint, text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_booking_ai_insight(bigint, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_booking_ai_insight(bigint, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_booking_ai_insight(bigint, text, text, text, boolean)
  to authenticated;
grant execute on function public.complete_booking_ai_insight(bigint, uuid, jsonb)
  to authenticated;
grant execute on function public.fail_booking_ai_insight(bigint, uuid, text)
  to authenticated;

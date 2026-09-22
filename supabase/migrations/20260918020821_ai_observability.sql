create table public.ai_runs (
  trace_id uuid primary key,
  created_at timestamptz not null default now(),
  surface text not null check (surface in ('concierge','operations','booking-insight')),
  status text not null check (status in ('completed','failed','cancelled','timeout','denied','rate-limited')),
  error_code text check (error_code in ('invalid-request','unauthorized','configuration','provider-unavailable','tool-error','timeout','cancelled','rate-limited','store-unavailable')),
  duration_ms integer not null check (duration_ms >= 0),
  ttft_ms integer check (ttft_ms >= 0),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  tool_names text[] not null default '{}',
  tool_error_count integer not null default 0 check (tool_error_count >= 0),
  model text not null check (model ~ '^[a-zA-Z0-9._:/-]{1,96}$'),
  prompt_version text not null check (prompt_version ~ '^[a-zA-Z0-9._:/-]{1,96}$')
);
create index ai_runs_created_at_idx on public.ai_runs(created_at);
create table public.ai_feedback (
  trace_id uuid primary key references public.ai_runs(trace_id) on delete cascade,
  rating text not null check (rating in ('helpful','not-helpful')),
  updated_at timestamptz not null default now()
);
create table public.ai_rate_buckets (
  bucket text primary key check (length(bucket) <= 128),
  window_start timestamptz not null,
  hits integer not null check (hits > 0)
);
alter table public.ai_runs enable row level security;
alter table public.ai_feedback enable row level security;
alter table public.ai_rate_buckets enable row level security;
revoke all on public.ai_runs, public.ai_feedback, public.ai_rate_buckets from public, anon, authenticated;
grant select on public.ai_runs, public.ai_feedback to authenticated;
grant select, insert, update, delete on public.ai_runs, public.ai_feedback, public.ai_rate_buckets to service_role;
create policy ai_runs_admin_read on public.ai_runs for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy ai_feedback_admin_read on public.ai_feedback for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Atomic UPSERT serializes competing requests for one bucket across instances.
-- SECURITY INVOKER; only the server service role receives EXECUTE.
create function public.consume_ai_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer default 60)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_row public.ai_rate_buckets;
begin
  if p_bucket is null or length(trim(p_bucket)) = 0 or length(p_bucket) > 128 or p_limit is null or p_window_seconds is null or p_limit not between 1 and 1000 or p_window_seconds not between 1 and 3600 then
    raise exception 'Invalid rate limit parameters';
  end if;
  insert into public.ai_rate_buckets(bucket,window_start,hits) values(p_bucket,v_now,1)
  on conflict(bucket) do update set
    window_start = case when ai_rate_buckets.window_start + make_interval(secs => p_window_seconds) <= v_now then v_now else ai_rate_buckets.window_start end,
    hits = case when ai_rate_buckets.window_start + make_interval(secs => p_window_seconds) <= v_now then 1 else least(ai_rate_buckets.hits + 1, p_limit + 1) end
  returning * into v_row;
  return jsonb_build_object('allowed',v_row.hits <= p_limit,'retry_after',greatest(1,ceil(extract(epoch from v_row.window_start + make_interval(secs => p_window_seconds) - v_now))));
end $$;
revoke all on function public.consume_ai_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_ai_rate_limit(text,integer,integer) to service_role;

create function public.cleanup_ai_observability() returns void language sql security invoker set search_path = '' as $$
  delete from public.ai_runs where created_at < now() - interval '30 days';
  delete from public.ai_rate_buckets where window_start < now() - interval '1 day';
$$;
revoke all on function public.cleanup_ai_observability() from public, anon, authenticated;
grant execute on function public.cleanup_ai_observability() to service_role;

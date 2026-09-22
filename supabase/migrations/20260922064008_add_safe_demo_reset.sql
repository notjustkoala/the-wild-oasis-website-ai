-- Feature06 demo reset. The public booking table carries immutable provenance,
-- while the canonical reset payload stays in an unexposed, RLS-protected table.
-- The only callable reset entrypoint is a parameterless, service-role-only RPC.

alter table public.bookings
  add column demo_dataset_id text;

alter table public.bookings
  add constraint bookings_demo_dataset_id_valid
  check (
    demo_dataset_id is null
    or demo_dataset_id = 'wild-oasis-demo-20260803-v1'
  );

create index bookings_demo_dataset_id_idx
  on public.bookings (demo_dataset_id)
  where demo_dataset_id is not null;

-- Existing table-level INSERT/UPDATE grants would let an authenticated admin
-- forge provenance. Replace them with column grants that deliberately omit
-- demo_dataset_id. RLS continues to decide which rows those operations reach.
revoke insert, update on table public.bookings from authenticated;

grant insert (
  created_at, "startDate", "endDate", "numNights", "numGuests",
  "cabinPrice", "extrasPrice", "totalPrice", status, "hasBreakfast",
  observations, "isPaid", "cabinId", "guestId", "internalNote"
) on table public.bookings to authenticated;

grant update (
  created_at, "startDate", "endDate", "numNights", "numGuests",
  "cabinPrice", "extrasPrice", "totalPrice", status, "hasBreakfast",
  observations, "isPaid", "cabinId", "guestId", "internalNote"
) on table public.bookings to authenticated;

-- Keep server access explicit for projects using the 2026 Data API defaults.
grant select, insert, update, delete on table public.bookings to service_role;
grant usage, select, update on sequence public.bookings_id_seq to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.demo_booking_baseline (
  id bigint primary key,
  demo_dataset_id text not null,
  created_at timestamptz not null,
  "startDate" timestamptz not null,
  "endDate" timestamptz not null,
  "numNights" integer not null,
  "numGuests" integer not null,
  "cabinPrice" numeric(12, 2) not null,
  "extrasPrice" numeric(12, 2) not null,
  "totalPrice" numeric(12, 2) not null,
  status text not null,
  "hasBreakfast" boolean not null,
  observations text not null,
  "isPaid" boolean not null,
  "cabinId" bigint not null,
  "guestId" bigint not null,
  "internalNote" text not null,
  constraint demo_booking_baseline_dataset_valid
    check (demo_dataset_id = 'wild-oasis-demo-20260803-v1'),
  constraint demo_booking_baseline_dates_valid
    check ("endDate" > "startDate"),
  constraint demo_booking_baseline_num_nights_positive
    check ("numNights" > 0),
  constraint demo_booking_baseline_num_guests_positive
    check ("numGuests" > 0),
  constraint demo_booking_baseline_prices_non_negative
    check ("cabinPrice" >= 0 and "extrasPrice" >= 0 and "totalPrice" >= 0),
  constraint demo_booking_baseline_total_price_consistent
    check ("totalPrice" = "cabinPrice" + "extrasPrice"),
  constraint demo_booking_baseline_stay_length_consistent
    check ("endDate" = "startDate" + make_interval(days => "numNights")),
  constraint demo_booking_baseline_status_valid
    check (status in ('unconfirmed', 'checked-in', 'checked-out', 'cancelled')),
  constraint demo_booking_baseline_internal_note_length
    check (char_length("internalNote") <= 500)
);

alter table private.demo_booking_baseline enable row level security;
alter table private.demo_booking_baseline force row level security;
revoke all privileges on table private.demo_booking_baseline
  from public, anon, authenticated, service_role;
grant select on table private.demo_booking_baseline to service_role;

create or replace function public.reset_demo_bookings()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dataset constant text := 'wild-oasis-demo-20260803-v1';
  v_baseline_count bigint;
  v_restored_count bigint;
  v_all_count bigint;
  v_max_id bigint;
begin
  -- Transaction-scoped and non-blocking: duplicate/overlapping Cron deliveries
  -- return a controlled busy status without touching any row.
  if not pg_catalog.pg_try_advisory_xact_lock(20260922, 60803) then
    return pg_catalog.jsonb_build_object(
      'status', 'busy',
      'restoredCount', 0
    );
  end if;

  select pg_catalog.count(*)
    into v_baseline_count
    from private.demo_booking_baseline
    where demo_dataset_id = v_dataset;

  if v_baseline_count = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'demo baseline unavailable';
  end if;

  -- Deleting only provenance-marked bookings cascades their Briefing and
  -- approval/audit state. Non-demo bookings and their related rows are untouched.
  delete from public.bookings
    where demo_dataset_id = v_dataset;

  insert into public.bookings (
    id, demo_dataset_id, created_at, "startDate", "endDate", "numNights",
    "numGuests", "cabinPrice", "extrasPrice", "totalPrice", status,
    "hasBreakfast", observations, "isPaid", "cabinId", "guestId",
    "internalNote"
  )
  select
    id, demo_dataset_id, created_at, "startDate", "endDate", "numNights",
    "numGuests", "cabinPrice", "extrasPrice", "totalPrice", status,
    "hasBreakfast", observations, "isPaid", "cabinId", "guestId",
    "internalNote"
  from private.demo_booking_baseline
  where demo_dataset_id = v_dataset
  order by id;

  get diagnostics v_restored_count = row_count;
  if v_restored_count <> v_baseline_count then
    raise exception using
      errcode = 'P0001',
      message = 'demo restore row count mismatch';
  end if;

  select pg_catalog.count(*), pg_catalog.max(id)
    into v_all_count, v_max_id
    from public.bookings;

  perform pg_catalog.setval(
    pg_catalog.pg_get_serial_sequence('public.bookings', 'id'),
    greatest(coalesce(v_max_id, 1), 1),
    v_all_count > 0
  );

  return pg_catalog.jsonb_build_object(
    'status', 'reset',
    'restoredCount', v_restored_count
  );
end;
$$;

revoke all on function public.reset_demo_bookings()
  from public, anon, authenticated, service_role;
grant execute on function public.reset_demo_bookings() to service_role;

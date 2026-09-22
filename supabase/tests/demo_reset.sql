-- Run as database owner after applying migrations and supabase/seed.sql.
-- Every mutation is contained in this transaction and rolled back.
begin;

do $permissions$
begin
  if has_schema_privilege('anon', 'private', 'usage')
    or has_schema_privilege('authenticated', 'private', 'usage') then
    raise exception 'client role can use private schema';
  end if;
  if has_table_privilege('anon', 'private.demo_booking_baseline', 'select')
    or has_table_privilege('authenticated', 'private.demo_booking_baseline', 'select') then
    raise exception 'client role can read private baseline';
  end if;
  if has_function_privilege('anon', 'public.reset_demo_bookings()', 'execute')
    or has_function_privilege('authenticated', 'public.reset_demo_bookings()', 'execute') then
    raise exception 'client role can execute demo reset';
  end if;
  if not has_function_privilege('service_role', 'public.reset_demo_bookings()', 'execute') then
    raise exception 'service role cannot execute demo reset';
  end if;
  if not has_sequence_privilege('service_role', 'public.bookings_id_seq', 'UPDATE') then
    raise exception 'service role cannot update bookings identity sequence';
  end if;
  if has_column_privilege('authenticated', 'public.bookings', 'demo_dataset_id', 'insert')
    or has_column_privilege('authenticated', 'public.bookings', 'demo_dataset_id', 'update') then
    raise exception 'authenticated role can forge demo provenance';
  end if;
end
$permissions$;

do $seed_contract$
begin
  if (select count(*) from private.demo_booking_baseline
      where demo_dataset_id = 'wild-oasis-demo-20260803-v1') <> 800 then
    raise exception 'expected 800 private baseline rows';
  end if;
  if (select count(*) from public.bookings
      where demo_dataset_id = 'wild-oasis-demo-20260803-v1') <> 800 then
    raise exception 'expected 800 public demo rows';
  end if;
  begin
    update public.bookings
      set demo_dataset_id = 'forged'
      where demo_dataset_id = 'wild-oasis-demo-20260803-v1'
        and id = (select min(id) from public.bookings
          where demo_dataset_id = 'wild-oasis-demo-20260803-v1');
    raise exception 'invalid provenance accepted';
  exception when check_violation then
    null;
  end;
end
$seed_contract$;

-- Create a cancelled non-demo row so it cannot collide with the active-stay
-- exclusion constraint. It must survive every successful reset unchanged.
insert into public.bookings (
  id, created_at, "startDate", "endDate", "numNights", "numGuests",
  "cabinPrice", "extrasPrice", "totalPrice", status, "hasBreakfast",
  observations, "isPaid", "cabinId", "guestId", "internalNote"
)
select
  (select max(id) + 1000 from public.bookings), created_at, "startDate",
  "endDate", "numNights", "numGuests", "cabinPrice", "extrasPrice",
  "totalPrice", 'cancelled', "hasBreakfast", 'non-demo-preserve',
  "isPaid", "cabinId", "guestId", 'non-demo-note'
from private.demo_booking_baseline
order by id
limit 1;

update public.bookings
  set observations = 'mutated-demo', "internalNote" = 'mutated-note'
  where id = (
    select min(id) from public.bookings
    where demo_dataset_id = 'wild-oasis-demo-20260803-v1'
  );

insert into public.booking_ai_insights (
  booking_id, result, model, prompt_version, source_hash, status, attempt_count
)
select min(id), '{"severity":"fixture"}'::jsonb, 'fixture', 'fixture-v1',
  repeat('a', 64), 'succeeded', 1
from public.bookings
where demo_dataset_id = 'wild-oasis-demo-20260803-v1';

set local role service_role;

do $successful_and_idempotent$
declare
  v_result jsonb;
  v_demo_id bigint;
  v_non_demo_id bigint;
begin
  select min(id) into v_demo_id from public.bookings
    where demo_dataset_id = 'wild-oasis-demo-20260803-v1';
  select id into v_non_demo_id from public.bookings
    where demo_dataset_id is null and observations = 'non-demo-preserve';

  v_result := public.reset_demo_bookings();
  if v_result <> '{"status":"reset","restoredCount":800}'::jsonb then
    raise exception 'unexpected first reset response: %', v_result;
  end if;
  if exists (select 1 from public.bookings
      where id = v_demo_id
        and (observations = 'mutated-demo' or "internalNote" = 'mutated-note')) then
    raise exception 'demo booking was not restored';
  end if;
  if exists (select 1 from public.booking_ai_insights where booking_id = v_demo_id) then
    raise exception 'demo cascade state was not cleared';
  end if;
  if not exists (select 1 from public.bookings
      where id = v_non_demo_id
        and demo_dataset_id is null
        and observations = 'non-demo-preserve'
        and "internalNote" = 'non-demo-note') then
    raise exception 'non-demo booking was modified or deleted';
  end if;

  v_result := public.reset_demo_bookings();
  if v_result <> '{"status":"reset","restoredCount":800}'::jsonb then
    raise exception 'unexpected repeated reset response: %', v_result;
  end if;
  if (select count(*) from public.bookings
      where demo_dataset_id = 'wild-oasis-demo-20260803-v1') <> 800 then
    raise exception 'repeated reset is not idempotent';
  end if;
end
$successful_and_idempotent$;

reset role;

-- Force an exclusion conflict during restore. The caught statement error must
-- roll back the function's earlier DELETE, proving partial reset is atomic.
do $partial_failure_rollback$
declare
  v_demo private.demo_booking_baseline%rowtype;
  v_conflict_id bigint;
begin
  select * into v_demo
  from private.demo_booking_baseline
  where status <> 'cancelled'
  order by id
  limit 1;

  update public.bookings set status = 'cancelled' where id = v_demo.id;
  select max(id) + 2000 into v_conflict_id from public.bookings;
  insert into public.bookings (
    id, created_at, "startDate", "endDate", "numNights", "numGuests",
    "cabinPrice", "extrasPrice", "totalPrice", status, "hasBreakfast",
    observations, "isPaid", "cabinId", "guestId", "internalNote"
  ) values (
    v_conflict_id, v_demo.created_at, v_demo."startDate", v_demo."endDate",
    v_demo."numNights", v_demo."numGuests", v_demo."cabinPrice",
    v_demo."extrasPrice", v_demo."totalPrice", 'unconfirmed',
    v_demo."hasBreakfast", 'non-demo-conflict', v_demo."isPaid",
    v_demo."cabinId", v_demo."guestId", ''
  );

  begin
    perform public.reset_demo_bookings();
    raise exception 'conflicting restore unexpectedly succeeded';
  exception when exclusion_violation then
    null;
  end;

  if not exists (select 1 from public.bookings where id = v_demo.id and status = 'cancelled') then
    raise exception 'failed reset did not roll back its demo delete';
  end if;
  if not exists (select 1 from public.bookings where id = v_conflict_id and observations = 'non-demo-conflict') then
    raise exception 'failed reset modified the non-demo conflict row';
  end if;
end
$partial_failure_rollback$;

rollback;

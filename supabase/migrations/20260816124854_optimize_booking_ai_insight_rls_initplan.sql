-- Supabase performance advisors require the auth helper itself to be wrapped
-- by the scalar subquery so Postgres can evaluate the JWT once per statement.
-- This follow-up migration intentionally preserves the roles and predicates of
-- the already-applied booking_ai_insights policies.
drop policy if exists booking_ai_insights_admin_select
  on public.booking_ai_insights;
drop policy if exists booking_ai_insights_admin_insert
  on public.booking_ai_insights;
drop policy if exists booking_ai_insights_admin_update
  on public.booking_ai_insights;

create policy booking_ai_insights_admin_select
  on public.booking_ai_insights
  for select
  to authenticated
  using (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy booking_ai_insights_admin_insert
  on public.booking_ai_insights
  for insert
  to authenticated
  with check (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy booking_ai_insights_admin_update
  on public.booking_ai_insights
  for update
  to authenticated
  using (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  );

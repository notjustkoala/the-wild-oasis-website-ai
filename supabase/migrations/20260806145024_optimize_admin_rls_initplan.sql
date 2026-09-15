begin;

-- Evaluate the immutable request JWT once per statement instead of once per
-- candidate row. ALTER POLICY preserves each policy's existing ALL command,
-- authenticated role, name, and authorization semantics.
alter policy cabins_admin_all
  on public.cabins
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

alter policy guests_admin_all
  on public.guests
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

alter policy settings_admin_all
  on public.settings
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

alter policy bookings_admin_all
  on public.bookings
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

commit;

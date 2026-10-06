-- Staff booking tools join cabins for publicly advertised names. Grant only
-- SELECT to the trusted staff role; existing admin writes and anon reads remain.
begin;
create policy cabins_staff_select
  on public.cabins for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'staff');
commit;

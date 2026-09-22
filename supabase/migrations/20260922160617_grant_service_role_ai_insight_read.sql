begin;

-- The service-only demo reset verification checks that booking cascades remove
-- derived AI insight rows. New Supabase projects no longer provide implicit
-- Data API grants, so keep this capability explicit and read-only.
grant select on table public.booking_ai_insights to service_role;

commit;

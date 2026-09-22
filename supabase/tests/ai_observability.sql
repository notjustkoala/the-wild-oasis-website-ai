-- Run as database owner. All fixtures and mutations roll back.
begin;
insert into public.ai_runs(trace_id,surface,status,duration_ms,model,prompt_version)
values ('00000000-0000-4000-8000-000000000005','concierge','completed',10,'fixture','test-v1');
set local role anon;
do $$ begin
  begin perform * from public.ai_runs; raise exception 'anon read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.consume_ai_rate_limit('forged',1,60); raise exception 'anon RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","app_metadata":{"role":"guest"},"user_metadata":{"role":"admin"}}',true);
do $$ begin
  if exists(select 1 from public.ai_runs) then raise exception 'forged user_metadata admin read allowed'; end if;
  begin insert into public.ai_feedback values('00000000-0000-4000-8000-000000000005','helpful',now()); raise exception 'client feedback write allowed'; exception when insufficient_privilege then null; end;
  begin perform public.consume_ai_rate_limit('forged',1,60); raise exception 'authenticated RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","app_metadata":{"role":"staff"}}',true);
do $$ begin if exists(select 1 from public.ai_runs) then raise exception 'staff read allowed'; end if; end $$;
select set_config('request.jwt.claims','{"role":"authenticated","app_metadata":{"role":"admin"}}',true);
do $$ begin
  if not exists(select 1 from public.ai_runs where trace_id='00000000-0000-4000-8000-000000000005') then raise exception 'admin read denied'; end if;
  begin delete from public.ai_runs; raise exception 'admin write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
insert into public.ai_feedback(trace_id,rating) values('00000000-0000-4000-8000-000000000005','helpful');
do $$ begin
  begin insert into public.ai_feedback(trace_id,rating) values('00000000-0000-4000-8000-000000000005','not-helpful'); raise exception 'duplicate feedback allowed'; exception when unique_violation then null; end;
  begin insert into public.ai_feedback(trace_id,rating) values('00000000-0000-4000-8000-000000000006','helpful'); raise exception 'orphan feedback allowed'; exception when foreign_key_violation then null; end;
  if not (public.consume_ai_rate_limit('feature05-test',1,60)->>'allowed')::boolean then raise exception 'first denied'; end if;
  if (public.consume_ai_rate_limit('feature05-test',1,60)->>'allowed')::boolean then raise exception 'over limit allowed'; end if;
end $$;
rollback;

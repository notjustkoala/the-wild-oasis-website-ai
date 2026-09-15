-- Run against the development database. Everything is rolled back; the probe
-- is never visible to another session and no business table is written.
begin;
set local statement_timeout = '20s';
create temporary table policy_closeout_probe(document_payload jsonb, chunks jsonb);
insert into policy_closeout_probe
select jsonb_build_object(
  'document_id', 'feature04-closeout-probe', 'version', 1,
  'title', d.title, 'scope', 'public', 'effective_date', d.effective_date,
  'source_path', 'closeout/transaction-only.md', 'content_hash', repeat('a',64),
  'embedding_model', d.embedding_model, 'embedding_dimensions', d.embedding_dimensions
), jsonb_agg(jsonb_build_object(
  'chunk_id', 'feature04-closeout-probe@1:' || c.chunk_index,
  'chunk_index', c.chunk_index, 'heading_path', c.heading_path,
  'section', c.section, 'content', c.content, 'content_hash', c.content_hash,
  'embedding', c.embedding::text::jsonb,
  'embedding_instruction_version', c.embedding_instruction_version
) order by c.chunk_index)
from public.policy_documents d join public.policy_chunks c
  on c.document_id=d.document_id and c.document_version=d.version
where d.document_id='pet-policy' and d.is_current
group by d.document_id,d.version;
grant select on policy_closeout_probe to service_role,anon,authenticated;

set local role service_role;
do $$
declare p jsonb; c jsonb; v2 jsonb; v3 jsonb; n integer;
begin
  select document_payload,chunks into strict p,c from policy_closeout_probe;
  if jsonb_array_length(c) <> 2 then raise exception 'Expected two pet source chunks'; end if;
  perform public.sync_policy_document(p,c);
  perform public.sync_policy_document(p,c);
  select count(*) into n from public.policy_chunks where document_id='feature04-closeout-probe';
  if n <> 2 then raise exception 'Repeated apply duplicated chunks'; end if;
  -- Change exactly one chunk. The unchanged chunk preserves its original vector.
  select jsonb_agg(jsonb_set(item,'{chunk_id}',to_jsonb(replace(item->>'chunk_id','@1:','@2:')))
    order by (item->>'chunk_index')::integer) into v2 from jsonb_array_elements(c) item;
  v2 := jsonb_set(v2,'{0,content}',to_jsonb((v2#>>'{0,content}') || ' Transaction-only verification.'));
  v2 := jsonb_set(v2,'{0,content_hash}',to_jsonb(repeat('b',64)));
  perform public.sync_policy_document(p || jsonb_build_object('version',2,'content_hash',repeat('c',64)),v2);
  if (select count(*) from public.policy_documents where document_id='feature04-closeout-probe' and is_current and version=2) <> 1
    or (select count(*) from public.policy_chunks where document_id='feature04-closeout-probe') <> 4 then
    raise exception 'Version/current history mismatch';
  end if;
  if not exists(select 1 from public.policy_chunks a join public.policy_chunks b
    on a.document_id=b.document_id and a.chunk_index=b.chunk_index
    where a.document_id='feature04-closeout-probe' and a.document_version=1 and b.document_version=2
      and a.chunk_index=1 and a.content_hash=b.content_hash and a.embedding::text=b.embedding::text) then
    raise exception 'Unchanged vector was not reused';
  end if;
  begin
    perform public.sync_policy_document(p,c);
    raise exception 'Rollback was allowed';
  exception when raise_exception then
    if sqlerrm <> 'Policy cannot reactivate an older version.' then raise; end if;
  end;
  begin
    perform public.sync_policy_document(p || jsonb_build_object('version',2,'content_hash',repeat('d',64)),v2);
    raise exception 'Same-version conflict was allowed';
  exception when raise_exception then
    if sqlerrm <> 'Policy content changed without a version bump.' then raise; end if;
  end;
  -- A bad second chunk must roll back the whole RPC, including current flags.
  select jsonb_agg(jsonb_set(item,'{chunk_id}',to_jsonb(replace(item->>'chunk_id','@2:','@3:')))
    order by (item->>'chunk_index')::integer) into v3 from jsonb_array_elements(v2) item;
  begin
    perform public.sync_policy_document(p || jsonb_build_object('version',3,'content_hash',repeat('e',64)),
      jsonb_set(v3,'{1,embedding}','[1,2]'::jsonb));
    raise exception 'Invalid vector was allowed';
  exception when data_exception then null;
  end;
  if (select count(*) from public.policy_documents where document_id='feature04-closeout-probe' and version=3) <> 0
    or (select count(*) from public.policy_documents where document_id='feature04-closeout-probe' and version=2 and is_current) <> 1 then
    raise exception 'Failed RPC changed current version';
  end if;
end $$;

set local role anon;
do $$
declare v extensions.vector(768);
begin
  select (chunks->0->'embedding')::text::extensions.vector into v from policy_closeout_probe;
  if (select count(*) from public.policy_documents where document_id='feature04-closeout-probe') <> 1
    or (select count(*) from public.policy_chunks where document_id='feature04-closeout-probe') <> 2 then
    raise exception 'Historical table rows are visible';
  end if;
  if exists(select 1 from public.match_policy_chunks('pet',v,6,0) where document_id='feature04-closeout-probe' and version<>2) then
    raise exception 'Historical RPC rows are visible';
  end if;
  if not exists(select 1 from public.match_policy_chunks('pet',v,6,0) where document_id='feature04-closeout-probe' and version=2) then
    raise exception 'Current version was not retrieved';
  end if;
end $$;
reset role;
rollback;
select 'PASS: first apply, repeat, one-chunk update, vector reuse, history isolation, rollback/conflict rejection, atomic failure' as result,
  (select count(*) from public.policy_documents where document_id='feature04-closeout-probe') as remaining_probe_documents;

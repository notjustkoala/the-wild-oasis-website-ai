-- Isolate embedding spaces; preserve existing public/staff RLS.
create or replace function public.match_policy_chunks_for_model(
  query_text text,
  query_embedding extensions.vector(768),
  requested_embedding_model text,
  requested_document_instruction_version text,
  result_count integer default 5,
  minimum_similarity real default 0.55
)
returns table (
  chunk_id text,
  document_id text,
  title text,
  section text,
  version integer,
  effective_date date,
  content text,
  scope text,
  semantic_similarity double precision,
  rrf_score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with input as (
    select
      left(regexp_replace(coalesce(query_text, ''), '[[:cntrl:]]+', ' ', 'g'), 500) as clean_query,
      query_embedding as embedding,
      least(greatest(coalesce(result_count, 5), 1), 6) as accepted_count,
      least(greatest(coalesce(minimum_similarity, 0.55), 0.0), 1.0)::double precision as accepted_similarity
  ),
  visible as (
    select
      chunk.chunk_id,
      chunk.document_id,
      document.title,
      chunk.section,
      document.version,
      document.effective_date,
      chunk.content,
      document.scope,
      1 - (chunk.embedding operator(extensions.<=>) input.embedding) as semantic_similarity,
      chunk.fts
    from public.policy_chunks as chunk
    join public.policy_documents as document
      on document.document_id = chunk.document_id
      and document.version = chunk.document_version
      and document.is_current
    cross join input
    where document.embedding_model = requested_embedding_model
      and document.embedding_dimensions = 768
      and chunk.embedding_instruction_version = requested_document_instruction_version
  ),
  semantic as (
    select chunk_id, row_number() over (order by semantic_similarity desc, chunk_id) as semantic_rank
    from visible
    order by semantic_similarity desc, chunk_id
    limit 30
  ),
  lexical as (
    select
      visible.chunk_id,
      row_number() over (
        order by ts_rank_cd(visible.fts, websearch_to_tsquery('simple'::regconfig, input.clean_query)) desc, visible.chunk_id
      ) as lexical_rank
    from visible
    cross join input
    where input.clean_query <> ''
      and visible.fts @@ websearch_to_tsquery('simple'::regconfig, input.clean_query)
    order by ts_rank_cd(visible.fts, websearch_to_tsquery('simple'::regconfig, input.clean_query)) desc, visible.chunk_id
    limit 30
  ),
  candidates as (
    select semantic.chunk_id from semantic
    union
    select lexical.chunk_id from lexical
  ),
  ranked as (
    select
      visible.*,
      coalesce(1.0 / (50 + semantic.semantic_rank), 0.0)
        + coalesce(1.0 / (50 + lexical.lexical_rank), 0.0) as score
    from candidates
    join visible using (chunk_id)
    left join semantic using (chunk_id)
    left join lexical using (chunk_id)
    cross join input
    where visible.semantic_similarity >= input.accepted_similarity
  )
  select
    ranked.chunk_id,
    ranked.document_id,
    ranked.title,
    ranked.section,
    ranked.version,
    ranked.effective_date,
    ranked.content,
    ranked.scope,
    ranked.semantic_similarity,
    ranked.score
  from ranked
  cross join input
  order by ranked.score desc, ranked.semantic_similarity desc, ranked.chunk_id
  limit (select accepted_count from input);
$$;

revoke all on function public.match_policy_chunks_for_model(text, extensions.vector, text, text, integer, real) from public, anon, authenticated, service_role;
grant execute on function public.match_policy_chunks_for_model(text, extensions.vector, text, text, integer, real) to anon, authenticated;


-- Legacy deployments keep reading only their original vector space.
create or replace function public.match_policy_chunks(
  query_text text,
  query_embedding extensions.vector(768),
  result_count integer default 5,
  minimum_similarity real default 0.55
)
returns table (
  chunk_id text,
  document_id text,
  title text,
  section text,
  version integer,
  effective_date date,
  content text,
  scope text,
  semantic_similarity double precision,
  rrf_score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.match_policy_chunks_for_model(query_text, query_embedding, 'gemini-embedding-2', 'policy-document-v1', result_count, minimum_similarity);
$$;

-- One transaction for the full corpus; reuse the existing service-only validator.
create or replace function public.sync_policy_documents_batch(payloads jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare item jsonb; changed integer := 0;
begin
  if payloads is null or jsonb_typeof(payloads) <> 'array' or jsonb_array_length(payloads) > 100 then
    raise exception 'Invalid policy batch.';
  end if;
  for item in select value from jsonb_array_elements(payloads) loop
    perform public.sync_policy_document(item -> 'document_payload', item -> 'chunk_payloads');
    changed := changed + 1;
  end loop;
  return jsonb_build_object('synchronized_documents', changed);
end;
$$;
revoke all on function public.sync_policy_documents_batch(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.sync_policy_documents_batch(jsonb) to service_role;

-- Nullable usage details: unknown or interrupted usage remains unknown.
alter table public.ai_runs
  add column provider text,
  add column reasoning_effort text,
  add column service_tier text,
  add column uncached_input_tokens integer check (uncached_input_tokens >= 0),
  add column cache_read_input_tokens integer check (cache_read_input_tokens >= 0),
  add column cache_write_input_tokens integer check (cache_write_input_tokens >= 0),
  add column reasoning_tokens integer check (reasoning_tokens >= 0);

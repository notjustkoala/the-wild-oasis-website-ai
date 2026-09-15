create extension if not exists vector with schema extensions;

create table public.policy_documents (
  document_id text not null,
  version integer not null check (version > 0),
  title text not null check (char_length(title) between 1 and 160),
  scope text not null check (scope in ('public', 'staff')),
  effective_date date not null,
  source_path text not null check (char_length(source_path) between 1 and 500),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_current boolean not null default false,
  embedding_model text not null,
  embedding_dimensions integer not null check (embedding_dimensions = 768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (document_id, version)
);

create unique index policy_documents_one_current_version_idx
  on public.policy_documents (document_id)
  where is_current;

create index policy_documents_current_scope_idx
  on public.policy_documents (scope, document_id, version)
  include (title, effective_date, content_hash)
  where is_current;

create table public.policy_chunks (
  chunk_id text primary key,
  document_id text not null,
  document_version integer not null check (document_version > 0),
  chunk_index integer not null check (chunk_index >= 0),
  heading_path text[] not null check (cardinality(heading_path) >= 2),
  section text not null check (char_length(section) between 1 and 200),
  content text not null check (char_length(content) between 1 and 2000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  embedding extensions.vector(768) not null,
  embedding_instruction_version text not null,
  fts tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(section, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_chunks_document_fk
    foreign key (document_id, document_version)
    references public.policy_documents (document_id, version)
    on delete cascade,
  constraint policy_chunks_document_index_key
    unique (document_id, document_version, chunk_index)
);

create index policy_chunks_fts_idx
  on public.policy_chunks using gin (fts);

create index policy_chunks_embedding_hnsw_idx
  on public.policy_chunks using hnsw (embedding extensions.vector_cosine_ops);

create index policy_chunks_document_version_idx
  on public.policy_chunks (document_id, document_version, chunk_index)
  include (chunk_id, section, content_hash, embedding_instruction_version);

alter table public.policy_documents enable row level security;
alter table public.policy_chunks enable row level security;

revoke all on table public.policy_documents from public, anon, authenticated, service_role;
revoke all on table public.policy_chunks from public, anon, authenticated, service_role;

grant select on table public.policy_documents to anon, authenticated;
grant select on table public.policy_chunks to anon, authenticated;
grant select, insert, update on table public.policy_documents to service_role;
grant select, insert, delete on table public.policy_chunks to service_role;

create policy policy_documents_anon_public_current
  on public.policy_documents
  for select
  to anon
  using (is_current and scope = 'public');

create policy policy_documents_authenticated_authorized_current
  on public.policy_documents
  for select
  to authenticated
  using (
    is_current
    and (
      scope = 'public'
      or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') in ('staff', 'admin')
    )
  );

create policy policy_documents_service_role_select
  on public.policy_documents
  for select
  to service_role
  using (true);

create policy policy_documents_service_role_insert
  on public.policy_documents
  for insert
  to service_role
  with check (true);

create policy policy_documents_service_role_update
  on public.policy_documents
  for update
  to service_role
  using (true)
  with check (true);

create policy policy_chunks_anon_public_current
  on public.policy_chunks
  for select
  to anon
  using (
    exists (
      select 1
      from public.policy_documents as document
      where document.document_id = policy_chunks.document_id
        and document.version = policy_chunks.document_version
        and document.is_current
        and document.scope = 'public'
    )
  );

create policy policy_chunks_authenticated_authorized_current
  on public.policy_chunks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.policy_documents as document
      where document.document_id = policy_chunks.document_id
        and document.version = policy_chunks.document_version
        and document.is_current
        and (
          document.scope = 'public'
          or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') in ('staff', 'admin')
        )
    )
  );

create policy policy_chunks_service_role_select
  on public.policy_chunks
  for select
  to service_role
  using (true);

create policy policy_chunks_service_role_insert
  on public.policy_chunks
  for insert
  to service_role
  with check (true);

create policy policy_chunks_service_role_delete
  on public.policy_chunks
  for delete
  to service_role
  using (true);

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

revoke all on function public.match_policy_chunks(text, extensions.vector, integer, real) from public, anon, authenticated, service_role;
grant execute on function public.match_policy_chunks(text, extensions.vector, integer, real) to anon, authenticated;

create or replace function public.sync_policy_document(
  document_payload jsonb,
  chunk_payloads jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  target_document_id text := nullif(btrim(document_payload ->> 'document_id'), '');
  target_version integer;
  existing_hash text;
  chunk_count integer := 0;
begin
  if target_document_id is null or char_length(target_document_id) > 120 then
    raise exception 'Invalid policy document id.';
  end if;

  if coalesce((document_payload ->> 'deactivate')::boolean, false) then
    update public.policy_documents
      set is_current = false, updated_at = now()
      where document_id = target_document_id and is_current;
    return jsonb_build_object('document_id', target_document_id, 'deactivated', true);
  end if;

  target_version := (document_payload ->> 'version')::integer;
  if target_version <= 0 or jsonb_typeof(chunk_payloads) <> 'array' or jsonb_array_length(chunk_payloads) = 0 then
    raise exception 'Invalid policy document payload.';
  end if;

  select content_hash into existing_hash
  from public.policy_documents
  where document_id = target_document_id and version = target_version;

  if existing_hash is not null and existing_hash <> document_payload ->> 'content_hash' then
    raise exception 'Policy content changed without a version bump.';
  end if;

  if exists (
    select 1 from public.policy_documents
    where document_id = target_document_id and version > target_version
  ) then
    raise exception 'Policy cannot reactivate an older version.';
  end if;

  update public.policy_documents
    set is_current = false, updated_at = now()
    where document_id = target_document_id and is_current;

  insert into public.policy_documents (
    document_id, version, title, scope, effective_date, source_path,
    content_hash, is_current, embedding_model, embedding_dimensions
  ) values (
    target_document_id,
    target_version,
    document_payload ->> 'title',
    document_payload ->> 'scope',
    (document_payload ->> 'effective_date')::date,
    document_payload ->> 'source_path',
    document_payload ->> 'content_hash',
    true,
    document_payload ->> 'embedding_model',
    (document_payload ->> 'embedding_dimensions')::integer
  )
  on conflict (document_id, version) do update set
    title = excluded.title,
    scope = excluded.scope,
    effective_date = excluded.effective_date,
    source_path = excluded.source_path,
    is_current = true,
    embedding_model = excluded.embedding_model,
    embedding_dimensions = excluded.embedding_dimensions,
    updated_at = now();

  delete from public.policy_chunks
    where document_id = target_document_id and document_version = target_version;

  insert into public.policy_chunks (
    chunk_id, document_id, document_version, chunk_index, heading_path,
    section, content, content_hash, embedding, embedding_instruction_version
  )
  select
    item ->> 'chunk_id',
    target_document_id,
    target_version,
    (item ->> 'chunk_index')::integer,
    array(select jsonb_array_elements_text(item -> 'heading_path')),
    item ->> 'section',
    item ->> 'content',
    item ->> 'content_hash',
    (item -> 'embedding')::text::extensions.vector,
    item ->> 'embedding_instruction_version'
  from jsonb_array_elements(chunk_payloads) as item;

  get diagnostics chunk_count = row_count;
  return jsonb_build_object(
    'document_id', target_document_id,
    'version', target_version,
    'chunks', chunk_count,
    'deactivated', false
  );
end;
$$;

revoke all on function public.sync_policy_document(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_policy_document(jsonb, jsonb) to service_role;

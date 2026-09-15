import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import config from "../../policy-rag.config.json";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationName = readdirSync(migrationsDirectory).find((name) => name.endsWith("_policy_rag.sql"));
if (!migrationName) throw new Error("The generated policy RAG migration is missing.");
const sql = readFileSync(join(migrationsDirectory, migrationName), "utf8").toLowerCase();

describe("policy RAG migration contract", () => {
  it("uses an unpinned pgvector extension and the fixed 768-dimensional model", () => {
    expect(sql).toMatch(/create extension if not exists vector with schema extensions\s*;/);
    expect(sql).not.toMatch(/create extension[^;]+version/);
    expect(sql).toContain("extensions.vector(768)");
    expect(sql).toContain("extensions.vector_cosine_ops");
    expect(sql).toContain("using hnsw");
    expect(sql).toContain("using gin");
  });

  it("keeps integer versions, current uniqueness, and document/chunk lineage", () => {
    expect(sql).toMatch(/version integer not null check \(version > 0\)/);
    expect(sql).toContain("primary key (document_id, version)");
    expect(sql).toMatch(/unique index policy_documents_one_current_version_idx[\s\S]+where is_current/);
    expect(sql).toContain("foreign key (document_id, document_version)");
    expect(sql).toContain("generated always as");
    expect(sql).toContain("to_tsvector('simple'::regconfig");
  });

  it("enables RLS, grants Data API access explicitly, and authorizes from app_metadata", () => {
    expect(sql).toContain("alter table public.policy_documents enable row level security");
    expect(sql).toContain("alter table public.policy_chunks enable row level security");
    expect(sql).toContain("revoke all on table public.policy_documents from public, anon, authenticated");
    expect(sql).toContain("grant select on table public.policy_documents to anon, authenticated");
    expect(sql).toContain("-> 'app_metadata' ->> 'role'");
    expect(sql).not.toContain("user_metadata");
  });

  it("gives service_role only synchronization operations and never document deletion", () => {
    expect(sql).toContain("revoke all on table public.policy_documents from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert, update on table public.policy_documents to service_role");
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*policy_documents[^;]*service_role/);
    expect(sql).toContain("grant select, insert, delete on table public.policy_chunks to service_role");
    expect(sql).not.toContain("policy_documents_service_role_delete");
  });

  it("exposes only bounded, scope-free SECURITY INVOKER retrieval", () => {
    const matchFunction = sql.slice(sql.indexOf("create or replace function public.match_policy_chunks"), sql.indexOf("create or replace function public.sync_policy_document"));
    expect(matchFunction).toContain("security invoker");
    expect(matchFunction).toContain("set search_path = ''");
    expect(matchFunction).toContain("websearch_to_tsquery('simple'::regconfig");
    expect(matchFunction).toContain("operator(extensions.<=>)");
    const parameters = matchFunction.slice(0, matchFunction.indexOf("returns table"));
    expect(parameters).not.toMatch(/\bscope\s+(text|varchar|character varying)[,)]/);
    expect(matchFunction).toContain("least(greatest(coalesce(result_count");
    expect(matchFunction).toContain("revoke all on function public.match_policy_chunks");
    expect(matchFunction).toContain("from public, anon, authenticated, service_role");
    expect(matchFunction).toContain("grant execute on function public.match_policy_chunks");
  });

  it("keeps synchronization service-role-only and transactional", () => {
    const syncFunction = sql.slice(sql.indexOf("create or replace function public.sync_policy_document"));
    expect(syncFunction).toContain("security invoker");
    expect(syncFunction).toContain("set search_path = ''");
    expect(syncFunction).toContain("changed without a version bump");
    expect(syncFunction).toContain("version > target_version");
    expect(syncFunction).toContain("cannot reactivate an older version");
    expect(syncFunction).toContain("revoke all on function public.sync_policy_document(jsonb, jsonb) from public, anon, authenticated");
    expect(syncFunction).toContain("grant execute on function public.sync_policy_document(jsonb, jsonb) to service_role");
  });

  it("keeps SQL candidate caps, thresholds, and RRF weights aligned with the local ranking configuration", () => {
    const { retrieval } = config;
    const matchFunction = sql.slice(sql.indexOf("create or replace function public.match_policy_chunks"), sql.indexOf("create or replace function public.sync_policy_document"));
    expect(matchFunction.match(new RegExp(`limit ${retrieval.candidateCount}\\b`, "g"))).toHaveLength(2);
    expect(matchFunction).toContain(`coalesce(minimum_similarity, ${retrieval.minimumSemanticSimilarity})`);
    expect(matchFunction).toContain(`coalesce(result_count, ${retrieval.matchCount})`);
    expect(matchFunction).toContain(`coalesce(${retrieval.semanticWeight.toFixed(1)} / (${retrieval.rrfK} + semantic.semantic_rank), 0.0)`);
    expect(matchFunction).toContain(`coalesce(${retrieval.fullTextWeight.toFixed(1)} / (${retrieval.rrfK} + lexical.lexical_rank), 0.0)`);
  });
});

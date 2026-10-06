import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const directory = "output/dashscope-policy-migration";
const corpus = JSON.parse(await readFile(`${directory}/prepared-corpus.json`, "utf8"));
const calibration = JSON.parse(await readFile(`${directory}/calibration-vectors.json`, "utf8"));
const hash = createHash("sha256").update(JSON.stringify(corpus.payloads)).digest("hex");
if (hash !== corpus.payloadHash || hash !== calibration.corpusHash || corpus.project !== "fadfglcobmxxsawxlmpb" || corpus.model !== "text-embedding-v4") throw new Error("Corpus identity mismatch.");
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const migration = await readFile("supabase/migrations/20261006033225_openai_policy_embedding_identity.sql", "utf8");
const sql = ["begin;", migration, "set local role service_role;", `select public.sync_policy_documents_batch(${literal(JSON.stringify(corpus.payloads))}::jsonb);`, "reset role;", "create temporary table calibration_results(case_id text,facet text,document_id text,scope text,section text,similarity double precision,rrf double precision);", "create temporary table isolation_results(role_name text,documents integer,staff_documents integer);", "grant select,insert on calibration_results,isolation_results to anon,authenticated;"];
for (const role of ["anon", "ordinary", "staff", "admin"]) {
  const pgRole = role === "anon" ? "anon" : "authenticated";
  sql.push(`set local role ${pgRole};`, `select set_config('request.jwt.claims',${literal(JSON.stringify({ role: pgRole, sub: "00000000-0000-4000-8000-000000000001", app_metadata: { role: role === "ordinary" ? "guest" : role }, user_metadata: { role: "admin" } }))},true);`, `insert into isolation_results select ${literal(role)},count(*),count(*) filter(where scope='staff') from public.policy_documents where is_current;`, "reset role;");
}
for (const row of calibration.cases) {
  if (!row.prepared.searchable) continue;
  const queries = row.facets.map((item,index) => ({ facet: String(index), query: item.query }));
  const role = row.caller === "staff" ? "authenticated" : "anon";
  sql.push(`set local role ${role};`, `select set_config('request.jwt.claims',${literal(JSON.stringify({ role, sub: "00000000-0000-4000-8000-000000000001", app_metadata: { role: row.caller === "staff" ? "staff" : "guest" } }))},true);`);
  for (const { facet, query } of queries) {
    const vector = calibration.vectors[query];
    if (!Array.isArray(vector) || vector.length !== 768 || !vector.every(Number.isFinite)) throw new Error("Query vector unavailable.");
    sql.push(`insert into calibration_results select ${literal(row.id)},${literal(facet)},document_id,scope,section,semantic_similarity,rrf_score from public.match_policy_chunks_for_model(${literal(query)},${literal(JSON.stringify(vector))}::extensions.vector,'text-embedding-v4','dashscope-policy-document-v1',6,0.0);`);
  }
  sql.push("reset role;");
}
sql.push("select jsonb_build_object('matches',(select jsonb_agg(to_jsonb(r) order by case_id,facet,rrf desc,similarity desc) from calibration_results r),'isolation',(select jsonb_agg(to_jsonb(i)) from isolation_results i),'anonBatchDenied',not has_function_privilege('anon','public.sync_policy_documents_batch(jsonb)','execute'),'authenticatedBatchDenied',not has_function_privilege('authenticated','public.sync_policy_documents_batch(jsonb)','execute')) as report;", "rollback;");
await writeFile(`${directory}/calibration-rollback.sql`, sql.join("\n"), "utf8");
await writeFile(`${directory}/activation.sql`, `${migration}\nset local role service_role;\nselect public.sync_policy_documents_batch(${literal(JSON.stringify(corpus.payloads))}::jsonb);\nreset role;`, "utf8");
console.log(JSON.stringify({ corpusHash: hash, cases: calibration.cases.length, sqlGenerated: true, databaseWrites: 0 }));

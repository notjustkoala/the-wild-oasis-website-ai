import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
for (const file of [".env.development.local", ".env.local"]) { try { process.loadEnvFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; } }
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Server-only Supabase configuration is required.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const [command, argument] = process.argv.slice(2);
function check(result) { if (result.error) throw new Error("Observability database operation failed."); return result.data; }
if (command === "trace") {
  if (!/^[0-9a-f-]{36}$/i.test(argument || "")) throw new Error("A trace UUID is required.");
  const data = check(await db.from("ai_runs").select("trace_id,created_at,surface,status,error_code,duration_ms,ttft_ms,input_tokens,output_tokens,tool_names,tool_error_count,model,prompt_version,ai_feedback(rating,updated_at)").eq("trace_id", argument));
  console.log(JSON.stringify(data, null, 2));
} else if (command === "cleanup" && argument === "--apply") {
  check(await db.rpc("cleanup_ai_observability")); console.log("Applied explicit retention cleanup: runs older than 30 days and rate buckets older than one day.");
} else if (command === "concurrency" && argument === "--live") {
  if (url !== "https://tupdbxiujsfaifqulgmt.supabase.co") throw new Error("Concurrency probe requires the approved development project.");
  const bucket = `feature05-probe:${randomUUID()}`;
  const report = { generatedAt: new Date().toISOString(), mode: "real-dev-database-concurrent-http", requestCount: 5, limit: 2, allowed: 0, denied: 0, requests: [], cleanupRemaining: null, cleanupSucceeded: false };
  const safeCode = value => typeof value === "string" && /^[A-Z0-9_-]{1,32}$/.test(value) ? value : "unknown";
  try {
    // Wait for every request before deleting the bucket; a fast rejection must not race cleanup.
    const rows = await Promise.allSettled(Array.from({ length: 5 }, () => db.rpc("consume_ai_rate_limit", { p_bucket: bucket, p_limit: 2, p_window_seconds: 60 }).abortSignal(AbortSignal.timeout(15_000))));
    report.requests = rows.map((row, index) => {
      if (row.status === "rejected") return { index, ok: false, status: null, code: "network-or-timeout" };
      const { data, error, status } = row.value;
      if (error) return { index, ok: false, status, code: status === 0 ? "network-or-timeout" : safeCode(error.code) };
      // PostgREST returns jsonb RPC results as an object.
      return { index, ok: typeof data?.allowed === "boolean", status, code: typeof data?.allowed === "boolean" ? null : "unexpected-shape", allowed: data?.allowed ?? null };
    });
    report.allowed = report.requests.filter(row => row.ok && row.allowed === true).length;
    report.denied = report.requests.filter(row => row.ok && row.allowed === false).length;
  } finally {
    try {
      check(await db.from("ai_rate_buckets").delete().eq("bucket", bucket).abortSignal(AbortSignal.timeout(15_000)));
      const remaining = check(await db.from("ai_rate_buckets").select("bucket").eq("bucket", bucket).abortSignal(AbortSignal.timeout(15_000)));
      report.cleanupRemaining = remaining.length;
      report.cleanupSucceeded = remaining.length === 0;
    } catch { report.cleanupSucceeded = false; }
    mkdirSync("tests/ai/reports/database", { recursive: true });
    writeFileSync(`tests/ai/reports/database/concurrency-${Date.now()}.json`, JSON.stringify(report, null, 2)+"\n");
    console.log(JSON.stringify(report));
  }
  if (report.allowed !== 2 || report.denied !== 3 || !report.cleanupSucceeded) process.exitCode = 1;
} else { console.error("Usage: npm run ai:observe -- trace UUID | cleanup --apply | concurrency --live"); process.exitCode = 2; }

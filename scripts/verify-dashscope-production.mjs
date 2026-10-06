import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";

const cli = spawnSync("cmd.exe", ["/d", "/s", "/c", "npx supabase projects api-keys --project-ref fadfglcobmxxsawxlmpb --reveal --output json --agent yes"], { windowsHide: true, env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", AI_HTTPS_PROXY: "" }, encoding: "utf8", timeout: 45_000 });
if (cli.status !== 0) { console.error("The authorized Supabase CLI could not retrieve test credentials."); process.exit(1); }
let keys;
try { const value = JSON.parse(cli.stdout); keys = Array.isArray(value) ? value : value.keys ?? value.data ?? []; } catch { console.error("Supabase credential response could not be decoded."); process.exit(1); }
const secret = keys.find(key => key.type === "secret" && key.name === "default")?.api_key ?? keys.find(key => key.name === "service_role")?.api_key;
const publicKey = keys.find(key => key.type === "publishable" && key.name === "default")?.api_key ?? keys.find(key => key.name === "anon")?.api_key;
if (!secret || !publicKey) { console.error("Required production test credentials unavailable."); process.exit(1); }
if (process.argv[2] === "--credentials-check") { console.log(JSON.stringify({ project: "fadfglcobmxxsawxlmpb", serverKeyAvailable: true, publishableKeyAvailable: true, keysPrinted: false })); process.exit(0); }
const origin = process.argv[2];
if (!/^https:\/\/the-wild-oasis-website-ai(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin || "")) throw new Error("Verified project deployment origin required.");
const url = "https://fadfglcobmxxsawxlmpb.supabase.co";
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, secret, options);
const created = [];
const report = { date: new Date().toISOString(), origin, project: "fadfglcobmxxsawxlmpb", checks: {}, temporaryAccountsCreated: 0, temporaryAccountsRemoved: 0 };
let error;
const clients = new Map();
async function ask(path, question, token, accept = "text/event-stream") {
  const response = await fetch(origin + path, { method: "POST", headers: { "content-type": "application/json", accept, ...(token ? { authorization: `Bearer ${token}`, origin: "https://the-wild-oasis-ai.vercel.app" } : {}) }, body: JSON.stringify({ messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: question }] }] }), signal: AbortSignal.timeout(100_000) });
  const text = await response.text();
  const events = text.split("\n").filter(line => line.startsWith("data: {")).map(line => { try { return JSON.parse(line.slice(6)); } catch { return null; } }).filter(Boolean);
  return { status: response.status, text, events, traceId: response.headers.get("x-ai-trace-id") };
}
function complete(result) { return result.status === 200 && !result.events.some(event => event.type === "error") && result.events.some(event => event.type === "finish" && event.finishReason === "stop") && result.events.some(event => event.type === "text-delta"); }
try {
  const guest = await ask("/api/ai/concierge", "2027-01-10到2027-01-13，2位客人，预算1200美元，希望安静。请推荐小屋。");
  if (!complete(guest) || !guest.events.some(event => event.type === "tool-output-available" && event.output?.kind === "cabin-search")) throw new Error("Guest cabin streaming verification failed.");
  report.checks.guestCabins = { completed: true, traceId: guest.traceId, textChunks: guest.events.filter(event => event.type === "text-delta").length };
  const policy = await ask("/api/ai/concierge", "可以带两只猫入住吗？");
  const policyResults = policy.events.filter(event => event.type === "tool-output-available" && event.output?.kind === "policy-search");
  if (!complete(policy) || !policyResults.some(event => event.output.status === "grounded" && event.output.citations.some(row => row.documentId === "pet-policy")) || policyResults.some(event => event.output.citations.some(row => row.scope === "staff"))) throw new Error("Guest policy retrieval verification failed.");
  report.checks.guestPolicy = { completed: true, traceId: policy.traceId, staffLeakage: false };
  for (const role of ["ordinary", "staff", "admin"]) {
    const email = `migration-${randomUUID()}@example.invalid`, password = `${randomUUID()}Aa9!`;
    const result = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: role === "ordinary" ? {} : { role }, user_metadata: role === "ordinary" ? { role: "admin" } : {} });
    if (result.error || !result.data.user) throw new Error("Temporary role account creation failed.");
    created.push(result.data.user.id);
    const client = createClient(url, publicKey, options);
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw new Error("Temporary role authentication failed.");
    clients.set(role, { client, token: signed.data.session.access_token });
  }
  report.temporaryAccountsCreated = created.length;
  const ordinary = await ask("/api/ai/admin", "严重过敏例外应该如何升级处理？", clients.get("ordinary").token);
  if (ordinary.status !== 403) throw new Error("Ordinary role authorization failed.");
  report.checks.ordinaryRoleDenied = true;
  const staff = await ask("/api/ai/admin", "严重过敏例外应该如何升级处理？请只解释流程，不要创建记录。", clients.get("staff").token);
  const evidence = staff.events.filter(event => event.type === "tool-output-available" && event.output?.kind === "policy-search");
  if (!complete(staff) || !evidence.some(event => event.output.status === "grounded" && event.output.citations.some(row => row.documentId === "exception-handling-sop"))) throw new Error("Authenticated Staff policy streaming verification failed.");
  report.checks.staffPolicy = { completed: true, traceId: staff.traceId, staffSopRetrieved: true, writeToolsCalled: staff.events.some(event => event.toolName === "addBookingInternalNote") };
  if (report.checks.staffPolicy.writeToolsCalled) throw new Error("Read-only policy verification unexpectedly attempted a write.");
  const bookings = await service.from("bookings").select("id").not("observations", "is", null).neq("observations", "").limit(1);
  if (bookings.error || !bookings.data?.length) throw new Error("Existing booking for Briefing verification unavailable.");
  const bookingId = bookings.data[0].id;
  const briefing = await fetch(`${origin}/api/ai/booking-insight/${bookingId}`, { method: "POST", headers: { authorization: `Bearer ${clients.get("admin").token}`, origin: "https://the-wild-oasis-ai.vercel.app", "content-type": "application/json" }, body: JSON.stringify({ force: false }), signal: AbortSignal.timeout(60_000) });
  const parsed = await briefing.json();
  if (!briefing.ok || !["cached", "reviewed"].includes(parsed.state) || parsed.insight?.model !== "qwen3.7-plus" || !parsed.insight?.result?.severity || !Array.isArray(parsed.insight.result.actionItems)) throw new Error("Admin Briefing verification failed.");
  report.checks.adminBriefing = { completed: true, model: parsed.insight.model, state: parsed.state, traceId: briefing.headers.get("x-ai-trace-id") };
} catch (failure) { error = failure instanceof Error ? failure.message : "Production verification failed."; }
finally {
  for (const account of clients.values()) await account.client.auth.signOut();
  for (const id of created) { const deleted = await service.auth.admin.deleteUser(id); if (!deleted.error) report.temporaryAccountsRemoved += 1; }
  await mkdir("output/dashscope-policy-migration", { recursive: true });
  await writeFile("output/dashscope-policy-migration/production-verification.json", JSON.stringify({ ...report, ...(error ? { error } : {}) }, null, 2), "utf8");
}
if (error || report.temporaryAccountsRemoved !== created.length) { console.log(JSON.stringify(report)); console.error(error || "Temporary account cleanup incomplete."); process.exitCode = 1; }
else console.log(JSON.stringify(report, null, 2));

import { POST, OPTIONS } from "@/app/api/ai/feedback/route";
import { issueFeedbackToken } from "@/app/_ai/observability/access";

const db = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), upsert: vi.fn() }));
vi.mock("@/app/_lib/supabase-server", () => ({ createPrivilegedSupabaseClient: () => ({ from: (table: string) => {
  if (table === "ai_feedback") return { upsert: (...args: unknown[]) => { db.upsert(...args); return { abortSignal: db.write }; } };
  const chain = { select: () => chain, eq: () => chain, abortSignal: () => chain, maybeSingle: db.read };
  return chain;
} }) }));
const traceId = "00000000-0000-4000-8000-000000000005";
const other = "00000000-0000-4000-8000-000000000006";
function request(body: unknown, origin = "https://site.example", type = "application/json") {
  return new Request("https://site.example/api/ai/feedback", { method: "POST", headers: { origin, "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function payload() { return { traceId, token: issueFeedbackToken(traceId, "concierge")!, rating: "helpful" }; }
describe("feedback HTTP permission and storage boundaries", () => {
  beforeEach(() => { vi.stubEnv("AI_OBSERVABILITY_SECRET", "fixture-only-secret"); db.read.mockResolvedValue({ data: { trace_id: traceId, surface: "concierge" }, error: null }); db.write.mockResolvedValue({ error: null }); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it("upserts one controlled rating per signed run and allows replacement", async () => {
    expect((await POST(request(payload()))).status).toBe(200);
    expect((await POST(request({ ...payload(), rating: "not-helpful" }))).status).toBe(200);
    expect(db.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ trace_id: traceId, rating: "not-helpful" }), { onConflict: "trace_id" });
  });
  it.each(["signature", "expiry", "cross-run", "trace-only"])("rejects %s without querying storage", async kind => {
    const data = payload();
    if (kind === "signature") data.token = data.token.slice(0, -1) + (data.token.endsWith("0") ? "1" : "0");
    if (kind === "expiry") data.token = issueFeedbackToken(traceId, "concierge", process.env, Date.now() - 3_600_001)!;
    if (kind === "cross-run") data.traceId = other;
    if (kind === "trace-only") data.token = traceId;
    expect((await POST(request(data))).status).toBe(403); expect(db.read).not.toHaveBeenCalled();
  });
  it("rejects an unknown run", async () => { db.read.mockResolvedValue({ data: null, error: null }); expect((await POST(request(payload()))).status).toBe(409); expect(db.write).not.toHaveBeenCalled(); });
  it.each(["{", { rating: "helpful" }, { traceId, token: "x", rating: "excellent" }, { traceId, token: "x", rating: "helpful", comment: "private" }])("rejects invalid JSON/body %j", async body => { expect((await POST(request(body))).status).toBe(400); expect(db.read).not.toHaveBeenCalled(); });
  it("bounds bodies and requires JSON", async () => { expect((await POST(request("x".repeat(1025)))).status).toBe(413); expect((await POST(request(payload(), undefined, "text/plain"))).status).toBe(415); });
  it("rejects foreign origins and preflight", async () => { expect((await POST(request(payload(), "https://evil.example"))).status).toBe(403); expect(OPTIONS(request(payload(), "https://evil.example")).status).toBe(403); expect(db.read).not.toHaveBeenCalled(); });
  it.each(["read", "write"] as const)("contains %s storage failure without private messages", async stage => { db[stage].mockRejectedValue(new Error("private@example.invalid")); const response = await POST(request(payload())); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private@"); });
});

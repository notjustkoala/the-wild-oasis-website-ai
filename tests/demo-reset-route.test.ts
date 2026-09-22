// @vitest-environment node

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/app/_lib/supabase-server", () => ({
  createPrivilegedSupabaseClient: () => ({ rpc }),
}));

import { GET } from "@/app/api/cron/demo-reset/route";

const secret = "fixture-cron-secret-with-at-least-32-characters";

function request(authorization?: string) {
  return new Request("https://guest.example.invalid/api/cron/demo-reset", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("demo reset Cron route", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_RESET_ENABLED", "true");
    vi.stubEnv("CRON_SECRET", secret);
    rpc.mockResolvedValue({
      data: { status: "reset", restoredCount: 800 },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed while the feature flag is disabled", async () => {
    vi.stubEnv("DEMO_RESET_ENABLED", "false");
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, status: "disabled" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([undefined, "short", ` ${secret}`, `${secret} `])(
    "fails closed for missing or weak server secret %j",
    async configuredSecret => {
      if (configuredSecret === undefined) delete process.env.CRON_SECRET;
      else vi.stubEnv("CRON_SECRET", configuredSecret);
      const response = await GET(request(`Bearer ${secret}`));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        status: "unavailable",
      });
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, "", "Bearer wrong-secret", secret])(
    "rejects missing or incorrect Authorization %j",
    async authorization => {
      const response = await GET(request(authorization));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        ok: false,
        status: "unauthorized",
      });
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it("calls only the allow-listed RPC and returns a controlled count", async () => {
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      status: "reset",
      restored: 800,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("reset_demo_bookings");
  });

  it("returns conflict for an overlapping reset without retrying", async () => {
    rpc.mockResolvedValue({
      data: { status: "busy", restoredCount: 0 },
      error: null,
    });
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      status: "busy",
      restored: 0,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: null, error: { message: "private database detail" } },
    { data: { status: "reset", restoredCount: 0 }, error: null },
    { data: { status: "other", restoredCount: 800 }, error: null },
  ])("contains RPC failure/invalid result %#", async result => {
    rpc.mockResolvedValue(result);
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });

  it("contains thrown server/client errors", async () => {
    rpc.mockRejectedValue(new Error("secret row and credential detail"));
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain("secret row");
    expect(body).not.toContain("credential");
  });
});

import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.create }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
it("forces fresh upstream reads while public presentation caching remains separate", async () => {
  vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "fixture-public-key");
  const fetcher = vi.fn().mockResolvedValue(Response.json([])); vi.stubGlobal("fetch", fetcher);
  mock.create.mockReturnValue({ from: vi.fn() });
  const { supabase, liveSupabase } = await import("@/app/_lib/supabase");
  liveSupabase.from("bookings");
  const options = mock.create.mock.calls[0][2];
  await options.global.fetch("https://fixture.supabase.co/rest/v1/bookings", { cache: "force-cache", method: "GET" });
  expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store", method: "GET" }));
  expect(options.auth.persistSession).toBe(false);
  supabase.from("cabins");
  expect(mock.create.mock.calls[1][2].global).toBeUndefined();
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), settings: vi.fn(), dates: vi.fn() }));
vi.mock("@/app/_lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/app/_lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/app/_lib/data-service", () => ({ getSettings: mocks.settings, getBookedDatesByCabinId: mocks.dates }));
import { GET as sessionGET } from "@/app/api/guest/session/route";
import { GET as availabilityGET } from "@/app/api/cabins/[cabinId]/availability/route";

const cabin = { id: 1, maxCapacity: 4, regularPrice: 200, discount: 20 };
const read = (id = "1") => availabilityGET(new Request(`http://localhost/api/cabins/${id}/availability`), { params: { cabinId: id } });
function cabinResult(data: typeof cabin | null, error: unknown = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  mocks.from.mockReturnValue(query);
  return query;
}
beforeEach(() => {
  vi.resetAllMocks();
  cabinResult(cabin);
  mocks.settings.mockResolvedValue({ minBookingLength: 2, maxBookingLength: 10, maxGuestsPerBooking: 3, privateSetting: "excluded" });
  mocks.dates.mockResolvedValue([new Date(2030, 0, 10)]);
});

describe("uncached guest reads", () => {
  it("returns only display identity, with private/no-store headers", async () => {
    mocks.auth.mockResolvedValue({ user: { name: "Demo Guest", image: null, email: "fixture@example.invalid", guestId: 99 } });
    const response = await sessionGET();
    expect(await response.json()).toEqual({ user: { name: "Demo Guest", image: null } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
  it("distinguishes anonymous login state from auth failure", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await (await sessionGET()).json()).toEqual({ user: null });
    mocks.auth.mockRejectedValue(new Error("sensitive provider details"));
    const response = await sessionGET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive");
  });
  it("returns current rules/prices and local date-only occupied nights without unrelated fields", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ cabin, settings: { minBookingLength: 2, maxBookingLength: 10, maxGuestsPerBooking: 3 }, bookedDates: ["2030-01-10"] });
    expect(mocks.dates).toHaveBeenCalledWith(1);
  });
  it.each(["0", "-1", "1.5", "abc", "9007199254740992"])("rejects invalid ID %s before database access", async id => {
    expect((await read(id)).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("returns 404 for a removed cabin and safe 503 for failed reads", async () => {
    cabinResult(null);
    expect((await read()).status).toBe(404);
    expect(mocks.dates).not.toHaveBeenCalled();
    cabinResult(null, new Error("database secret"));
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
  it("does not return malformed rules as a successful availability result", async () => {
    mocks.settings.mockResolvedValue({ minBookingLength: 20, maxBookingLength: 2, maxGuestsPerBooking: 3 });
    expect((await read()).status).toBe(503);
  });
});

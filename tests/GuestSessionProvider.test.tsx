import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
import GuestSessionProvider, { useGuestSession } from "@/app/_components/GuestSessionProvider";
function Consumer() { const session = useGuestSession(); return <span>{session.status}:{session.user?.name ?? "anonymous"}</span>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shares one private request between navigation and reservation and refreshes on focus", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ user: { name: "Demo", image: null } }))
    .mockResolvedValueOnce(Response.json({ user: null }));
  vi.stubGlobal("fetch", fetcher);
  render(<GuestSessionProvider><Consumer /><Consumer /></GuestSessionProvider>);
  expect(await screen.findAllByText("ready:Demo")).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith("/api/guest/session", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(await screen.findAllByText("ready:anonymous")).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ session: { status: "ready", user: { name: "Demo", image: null }, retry: vi.fn() } }));
vi.mock("@/app/_components/GuestSessionProvider", () => ({ useGuestSession: () => fixtures.session }));
vi.mock("@/app/_components/DateSelector", () => ({ default: ({ cabin, bookedDates }: { cabin: { regularPrice: number }; bookedDates: Date[] }) =>
  <div>Current price {cabin.regularPrice}; occupied {bookedDates.map(day => day.getDate()).join(",")}</div> }));
vi.mock("@/app/_components/ReservationForm", () => ({ default: ({ cabin }: { cabin: { id: number; maxCapacity: number } }) =>
  <button>Reserve cabin {cabin.id} for at most {cabin.maxCapacity}</button> }));
import Reservation from "@/app/_components/Reservation";
const availability = (id = 1) => ({ cabin: { id, maxCapacity: 8, regularPrice: 320, discount: 0 },
  settings: { minBookingLength: 2, maxBookingLength: 10, maxGuestsPerBooking: 4 }, bookedDates: ["2030-01-10"] });
beforeEach(() => { fixtures.session.status = "ready"; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("dynamic reservation region", () => {
  it("renders no booking form before live data arrives, then uses current price and guest limits", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal("fetch", fetcher);
    render(<Reservation cabinId={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading current availability");
    expect(screen.queryByRole("button", { name: /Reserve cabin/ })).not.toBeInTheDocument();
    await act(async () => resolve(Response.json(availability())));
    expect(await screen.findByText(/Current price 320; occupied 10/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reserve cabin 1 for at most 4" })).toBeInTheDocument();
    expect(fetcher.mock.calls[0]).toEqual(["/api/cabins/1/availability", expect.objectContaining({ cache: "no-store" })]);
  });
  it("fails closed and lets the guest retry after a failed inventory request", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 })).mockResolvedValueOnce(Response.json(availability()));
    vi.stubGlobal("fetch", fetcher);
    render(<Reservation cabinId={1} />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: /Reserve cabin/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry availability" }));
    expect(await screen.findByRole("button", { name: /Reserve cabin 1/ })).toBeInTheDocument();
  });
  it("ignores late results from the previous cabin and aborts that request", async () => {
    let resolveOld!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolveOld = done; }))
      .mockResolvedValueOnce(Response.json(availability(2)));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<Reservation cabinId={1} />);
    view.rerender(<Reservation cabinId={2} />);
    expect(await screen.findByRole("button", { name: /Reserve cabin 2/ })).toBeInTheDocument();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolveOld(Response.json(availability(1))));
    expect(screen.queryByRole("button", { name: /Reserve cabin 1/ })).not.toBeInTheDocument();
  });
  it("does not interpret a login read failure as anonymous and offer a booking form", async () => {
    fixtures.session.status = "error";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(availability())));
    render(<Reservation cabinId={1} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("login status"));
    fireEvent.click(screen.getByRole("button", { name: "Retry login status" }));
    expect(fixtures.session.retry).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Reserve cabin/ })).not.toBeInTheDocument();
  });
  it("rejects impossible calendar dates", async () => {
    const invalid = { ...availability(), bookedDates: ["2030-02-30"] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(invalid)));
    render(<Reservation cabinId={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("availability");
  });
  it("rejects a valid response for a different room", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(availability(2))));
    render(<Reservation cabinId={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("availability");
    expect(screen.queryByRole("button", { name: /Reserve cabin/ })).not.toBeInTheDocument();
  });
});

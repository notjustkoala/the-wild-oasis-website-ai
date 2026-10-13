import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/app/_components/GuestSessionProvider", () => ({ useGuestSession: () => ({ status: "ready", user: null }) }));
vi.mock("@/app/_components/ReservationForm", () => ({ default: () => null }));
import Reservation from "@/app/_components/Reservation";
import { ReservationProvider } from "@/app/_components/ReservationContext";
const data = (bookedDates: string[]) => ({ cabin: { id: 3, regularPrice: 300, discount: 0, maxCapacity: 4 },
  settings: { minBookingLength: 3, maxBookingLength: 30, maxGuestsPerBooking: 8 }, bookedDates });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("preserves the viewed month during refresh, shows a spinner and then blocks newly booked nights", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(data([])))
    .mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetcher);
  const { container } = render(<ReservationProvider><Reservation cabinId={3} /></ReservationProvider>);
  expect(container.querySelector(".spinner")).toBeInTheDocument();
  await screen.findByRole("grid");
  fireEvent.change(screen.getByRole("combobox", { name: "Choose the Year" }), { target: { value: "2030" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Choose the Month" }), { target: { value: "7" } });
  expect(screen.getByRole("grid", { name: "August 2030" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Refresh availability" }));
  expect(screen.getByRole("grid", { name: "August 2030" })).toBeVisible();
  expect(container.querySelector(".spinner-mini")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh availability" })).toBeDisabled();
  await act(async () => resolve(Response.json(data(["2030-08-10", "2030-08-11", "2030-08-12"]))));
  expect(screen.getByRole("grid", { name: "August 2030" })).toBeVisible();
  expect(screen.getByRole("button", { name: /August 10th, 2030/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /August 13th, 2030/ })).toBeEnabled();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

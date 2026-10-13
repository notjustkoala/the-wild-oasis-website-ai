import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DateSelector from "@/app/_components/DateSelector";
import { ReservationProvider } from "@/app/_components/ReservationContext";

const day = (value: number) => new Date(2030, 7, value);
const button = (value: number) => screen.getByRole("button", { name: new RegExp(`August ${value}(?:st|nd|rd|th), 2030`) });
const occupied = [day(10), day(11), day(12)];
function calendar(dates: Date[]) {
  return <ReservationProvider><DateSelector settings={{ minBookingLength: 3, maxBookingLength: 30 }}
    cabin={{ id: 1, regularPrice: 250, discount: 0 }} bookedDates={dates} /></ReservationProvider>;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2030, 7, 1)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("actual DayPicker half-open availability", () => {
  it("disables booked nights but allows the existing checkout day as a new arrival", () => {
    render(calendar(occupied));
    for (const value of [10, 11, 12]) expect(button(value)).toBeDisabled();
    expect(button(13)).toBeEnabled();
    fireEvent.click(button(13));
    fireEvent.click(button(16));
    expect(screen.getByText("Aug 13, 2030")).toBeVisible();
    expect(screen.getByText("Aug 16, 2030")).toBeVisible();
    expect(screen.getByText("3 nights selected")).toBeVisible();
  });
  it("permits checkout on the next booking's arrival day without permitting its occupied night", () => {
    render(calendar(occupied));
    expect(button(10)).toBeDisabled();
    fireEvent.click(button(7));
    expect(button(10)).toBeEnabled();
    expect(button(11)).toBeDisabled();
    fireEvent.click(button(10));
    expect(screen.getByText("Aug 7, 2030")).toBeVisible();
    expect(screen.getByText("Aug 10, 2030")).toBeVisible();
    expect(screen.getByText("3 nights selected")).toBeVisible();
  });
  it("clears a stale selected range when refreshed inventory occupies it", () => {
    const view = render(calendar([]));
    fireEvent.click(button(13)); fireEvent.click(button(16));
    view.rerender(calendar([day(13), day(14), day(15)]));
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
    for (const value of [13, 14, 15]) expect(button(value)).toBeDisabled();
    expect(button(16)).toBeEnabled();
    expect(screen.queryByText("3 nights selected")).not.toBeInTheDocument();
  });
});

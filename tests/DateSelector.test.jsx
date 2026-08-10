import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calendar = vi.hoisted(() => ({ props: undefined }));
const reservation = vi.hoisted(() => ({
  range: {},
  setRange: vi.fn(),
  resetRange: vi.fn(),
}));

vi.mock("react-day-picker", () => ({
  DayPicker: (props) => {
    calendar.props = props;
    return <div data-testid="day-picker" />;
  },
}));

vi.mock("../app/_components/ReservationContext", () => ({
  useReservation: () => reservation,
}));

import DateSelector from "../app/_components/DateSelector";

const date = (day) => new Date(2030, 7, day);

describe("DateSelector booking boundaries", () => {
  beforeEach(() => {
    calendar.props = undefined;
    reservation.range = {};
  });

  it("passes server night limits to DayPicker without an off-by-one", () => {
    render(
      <DateSelector
        settings={{ minBookingLength: 2, maxBookingLength: 7 }}
        cabin={{ regularPrice: 500, discount: 50 }}
        bookedDates={[]}
      />
    );

    expect(calendar.props.min).toBe(2);
    expect(calendar.props.max).toBe(7);
  });

  it("keeps adjacent endpoints selectable but rejects crossing an occupied night", () => {
    const occupiedNights = [date(10), date(11), date(12)];
    render(
      <DateSelector
        settings={{ minBookingLength: 2, maxBookingLength: 7 }}
        cabin={{ regularPrice: 500, discount: 50 }}
        bookedDates={occupiedNights}
      />
    );

    expect(calendar.props.modifiers.occupied).toEqual(occupiedNights);
    expect(calendar.props.disabled(date(10))).toBe(false);

    act(() => calendar.props.onSelect({ from: date(7), to: date(10) }));
    expect(reservation.setRange).toHaveBeenLastCalledWith({
      from: date(7),
      to: date(10),
    });

    act(() => calendar.props.onSelect({ from: date(13), to: date(16) }));
    expect(reservation.setRange).toHaveBeenLastCalledWith({
      from: date(13),
      to: date(16),
    });

    reservation.setRange.mockClear();
    act(() => calendar.props.onSelect({ from: date(9), to: date(11) }));
    expect(reservation.setRange).not.toHaveBeenCalled();
  });
});

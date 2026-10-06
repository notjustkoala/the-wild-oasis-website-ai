import { fireEvent, render, screen } from "@testing-library/react";
import DateSelector from "../app/_components/DateSelector";
import { ReservationProvider, useReservation } from "../app/_components/ReservationContext";

function ApplyDraft() {
  const { adoptDraft } = useReservation();
  return <button onClick={() => adoptDraft({ cabinId: 1, startDate: "2027-01-10", endDate: "2027-01-13", numGuests: 2 })}>Apply test plan</button>;
}
it("shows the adopted month and selected interval in the actual calendar", () => {
  const { container } = render(<ReservationProvider><ApplyDraft /><DateSelector settings={{ minBookingLength: 3, maxBookingLength: 30 }} cabin={{ id: 1, regularPrice: 250, discount: 0 }} bookedDates={[]} /></ReservationProvider>);
  fireEvent.click(screen.getByText("Apply test plan"));
  expect(screen.getByText("Jan 10, 2027")).toBeVisible();
  expect(screen.getByText("Jan 13, 2027")).toBeVisible();
  expect(container.querySelectorAll('[aria-selected="true"]').length).toBeGreaterThan(1);
  expect(screen.getByText("3 nights selected")).toBeVisible();
});

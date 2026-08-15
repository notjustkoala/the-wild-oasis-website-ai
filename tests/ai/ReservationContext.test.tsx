import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createReservationDraft } from "@/app/_lib/reservation-draft";

describe("AI reservation draft", () => {
  it("normalizes the adopted client-only draft and local date range", () => {
    const result = createReservationDraft({
      cabinId: 7,
      startDate: "2026-10-02",
      endDate: "2026-10-05",
      numGuests: 4,
    });
    expect(result.draft).toEqual({
      cabinId: 7,
      startDate: "2026-10-02",
      endDate: "2026-10-05",
      numGuests: 4,
    });
    expect(result.range.from.getFullYear()).toBe(2026);
    expect(result.range.from.getMonth()).toBe(9);
    expect(result.range.from.getDate()).toBe(2);
  });

  it("rejects incomplete or reversed plans and does not call a booking action", () => {
    expect(() =>
      createReservationDraft({
        cabinId: 7,
        startDate: "2026-10-05",
        endDate: "2026-10-02",
        numGuests: 4,
      })
    ).toThrow(/Checkout/);

    const contextSource = readFileSync(
      join(process.cwd(), "app/_components/ReservationContext.js"),
      "utf8"
    );
    expect(contextSource).toMatch(/adoptDraft/);
    expect(contextSource).not.toMatch(/createBooking|\.insert\s*\(/);
  });
});

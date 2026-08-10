import { describe, expect, it } from "vitest";
import {
  getStayQuote,
  isStayRangeAvailable,
  stayRangesOverlap,
  validateStay,
} from "../app/_lib/booking-domain";

describe("booking domain", () => {
  it("uses the discounted nightly price for every night", () => {
    expect(
      getStayQuote({
        startDate: "2026-08-10",
        endDate: "2026-08-13",
        regularPrice: 500,
        discount: 50,
      })
    ).toEqual({ nightlyPrice: 450, numNights: 3, cabinPrice: 1350 });
  });

  it("treats checkout and next check-in on the same day as non-overlapping", () => {
    expect(
      stayRangesOverlap(
        { startDate: "2026-08-10", endDate: "2026-08-13" },
        { startDate: "2026-08-13", endDate: "2026-08-16" }
      )
    ).toBe(false);
    expect(
      stayRangesOverlap(
        { startDate: "2026-08-10", endDate: "2026-08-14" },
        { startDate: "2026-08-13", endDate: "2026-08-16" }
      )
    ).toBe(true);
  });

  it("allows both adjacent endpoints and rejects crossing an occupied night", () => {
    const occupiedNights = ["2026-08-10", "2026-08-11", "2026-08-12"];

    expect(
      isStayRangeAvailable(
        { from: "2026-08-07", to: "2026-08-10" },
        occupiedNights
      )
    ).toBe(true);
    expect(
      isStayRangeAvailable(
        { from: "2026-08-13", to: "2026-08-16" },
        occupiedNights
      )
    ).toBe(true);
    expect(
      isStayRangeAvailable(
        { from: "2026-08-09", to: "2026-08-11" },
        occupiedNights
      )
    ).toBe(false);
    expect(
      isStayRangeAvailable({ from: "2026-08-10" }, occupiedNights)
    ).toBe(false);
  });

  it("rejects invalid stay lengths and cabin capacity", () => {
    const common = {
      maxCapacity: 2,
      minBookingLength: 2,
      maxBookingLength: 7,
    };

    expect(
      validateStay({
        ...common,
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        numGuests: 1,
      })
    ).toMatchObject({ ok: false, error: { code: "INVALID_STAY_LENGTH" } });

    expect(
      validateStay({
        ...common,
        startDate: "2026-08-10",
        endDate: "2026-08-13",
        numGuests: 3,
      })
    ).toMatchObject({
      ok: false,
      error: { code: "CABIN_CAPACITY_EXCEEDED" },
    });

    expect(
      validateStay({
        ...common,
        startDate: "2026-08-10",
        endDate: "2026-08-12",
        numGuests: 2,
      })
    ).toMatchObject({ ok: true, value: { numNights: 2 } });

    expect(
      validateStay({
        ...common,
        startDate: "2026-08-10",
        endDate: "2026-08-17",
        numGuests: 2,
      })
    ).toMatchObject({ ok: true, value: { numNights: 7 } });

    expect(
      validateStay({
        ...common,
        startDate: "2026-08-10",
        endDate: "2026-08-18",
        numGuests: 2,
      })
    ).toMatchObject({ ok: false, error: { code: "INVALID_STAY_LENGTH" } });
  });
});

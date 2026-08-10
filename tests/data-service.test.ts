import { describe, expect, it } from "vitest";
import { getOccupiedDates } from "../app/_lib/data-service";

function asDateOnly(dates: Date[]) {
  return dates.map((date) => {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
}

describe("booking availability data", () => {
  it("excludes cancelled stays and every checkout day", () => {
    const result = getOccupiedDates([
      {
        status: "unconfirmed",
        startDate: "2030-08-10",
        endDate: "2030-08-13",
      },
      {
        status: "cancelled",
        startDate: "2030-08-20",
        endDate: "2030-08-23",
      },
    ]);

    expect(asDateOnly(result)).toEqual([
      "2030-08-10",
      "2030-08-11",
      "2030-08-12",
    ]);
  });
});

"use client";

import { isPast } from "date-fns";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { useReservation } from "./ReservationContext";
import {
  getStayQuote,
  isStayRangeAvailable,
} from "../_lib/booking-domain";
import PriceSummary from "./PriceSummary";

function DateSelector({ settings, cabin, bookedDates }) {
  const { range, setRange, resetRange, draft } = useReservation();

  const { regularPrice, discount } = cabin;
  const quote = getStayQuote({
    startDate: range?.from,
    endDate: range?.to,
    regularPrice,
    discount,
  });

  const { minBookingLength, maxBookingLength } = settings;

  function handleSelect(nextRange) {
    if (!nextRange) {
      resetRange();
      return;
    }

    if (isStayRangeAvailable(nextRange, bookedDates)) setRange(nextRange);
  }

  return (
    <div className="flex flex-col justify-between">
      {draft?.cabinId === cabin.id ? (
        <p className="px-8 pt-5 text-sm text-accent-300" role="status">
          AI plan applied. Review the dates before reserving.
        </p>
      ) : null}
      <DayPicker
        className="py-9 px-24 "
        mode="range"
        onSelect={handleSelect}
        selected={range}
        min={minBookingLength}
        max={maxBookingLength}
        fromMonth={new Date()}
        fromDate={new Date()}
        toYear={new Date().getFullYear() + 5}
        captionLayout="dropdown"
        numberOfMonths={2}
        disabled={isPast}
        modifiers={{ occupied: bookedDates }}
        modifiersClassNames={{
          occupied: "line-through text-primary-400",
        }}
      />

      <div className="flex items-center justify-between px-8 bg-accent-500 text-primary-800 h-[72px]">
        <PriceSummary
          regularPrice={regularPrice}
          discount={discount}
          quote={quote}
        />

        {range.from || range.to ? (
          <button
            className="border border-primary-800 py-2 px-4 text-sm font-semibold"
            onClick={resetRange}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default DateSelector;

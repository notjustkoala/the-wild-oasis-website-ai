"use client";

import { useEffect, useRef, useState } from "react";
import { addYears, differenceInCalendarDays, format, isBefore, startOfDay, startOfMonth } from "date-fns";
import { DayPicker } from "react-day-picker";
import { useReservation } from "./ReservationContext";
import { getStayQuote, isStayRangeAvailable } from "../_lib/booking-domain";
import PriceSummary from "./PriceSummary";

export default function DateSelector({ settings, cabin, bookedDates }) {
  const { range, setRange, resetRange, draft } = useReservation();
  const today = startOfDay(new Date());
  const container = useRef(null);
  const [months, setMonths] = useState(1);
  const [month, setMonth] = useState(() => startOfMonth(range?.from ?? today));
  const [notice, setNotice] = useState("");
  const { minBookingLength: min, maxBookingLength: max } = settings;
  const quote = getStayQuote({ startDate: range?.from, endDate: range?.to, regularPrice: cabin.regularPrice, discount: cabin.discount });

  useEffect(() => {
    if (draft && draft.cabinId === cabin.id && draft.startDate) {
      const [year, monthNumber, day] = draft.startDate.split("-").map(Number);
      setMonth(startOfMonth(new Date(year, monthNumber - 1, day)));
      setNotice("");
    }
  }, [draft, cabin.id]);

  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => setMonths(entries[0].contentRect.width >= 620 ? 2 : 1));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  function disabled(day) {
    if (isBefore(day, today)) return true;
    // An occupied night can still be a valid checkout boundary. The half-open
    // booking validator remains authoritative; never disable that boundary blindly.
    if (range?.from && !range?.to && day > range.from) {
      const nights = differenceInCalendarDays(day, range.from);
      return nights < min || nights > max || !isStayRangeAvailable({ from: range.from, to: day }, bookedDates);
    }
    return false;
  }

  function handleSelect(nextRange, clickedDay) {
    setNotice("");
    if (!nextRange) { resetRange(); return; }
    if (clickedDay && range?.from && range?.to) {
      if (bookedDates.some(date => startOfDay(new Date(date)).getTime() === startOfDay(clickedDay).getTime())) {
        setNotice("This night is booked. Choose another check-in date."); return;
      }
      setRange({ from: clickedDay, to: undefined }); return;
    }
    if (!isStayRangeAvailable(nextRange, bookedDates)) {
      setNotice("Those dates include a booked night. Please choose another range."); return;
    }
    setRange(nextRange);
  }

  return <section ref={container} className="min-w-0 flex flex-col" aria-label="Stay dates">
    {draft && draft.cabinId === cabin.id ? <p className="px-6 pt-5 text-sm text-accent-300" role="status">AI plan applied. Review the selected dates before reserving.</p> : null}
    <div className="grid grid-cols-2 gap-3 px-6 pt-5">
      <div className="rounded-lg border border-primary-700 bg-primary-900 p-3"><span className="block text-xs text-primary-300">Check-in</span><strong>{range?.from ? format(range.from, "MMM d, yyyy") : "Choose date"}</strong></div>
      <div className="rounded-lg border border-primary-700 bg-primary-900 p-3"><span className="block text-xs text-primary-300">Check-out</span><strong>{range?.to ? format(range.to, "MMM d, yyyy") : "Choose date"}</strong></div>
    </div>
    <p className="px-6 pt-3 text-sm text-primary-300">Select check-in, then check-out · {min}–{max} nights. Click a date to start a new selection.</p>
    <div className="flex min-w-0 justify-center px-3 py-5">
      <DayPicker className="booking-calendar" mode="range" month={month} onMonthChange={setMonth}
        selected={range} onSelect={handleSelect} min={min} max={max}
        startMonth={startOfMonth(today)} endMonth={startOfMonth(addYears(today, 5))}
        captionLayout="dropdown" navLayout="after" numberOfMonths={months} showOutsideDays={false}
        disabled={disabled} modifiers={{ occupied: bookedDates }}
        modifiersClassNames={{ occupied: "booking-occupied" }}
        footer={range?.from && range?.to ? `${quote.numNights} nights selected` : range?.from ? "Now choose your check-out date" : "Choose your check-in date"} />
    </div>
    {notice ? <p role="alert" className="px-6 pb-4 text-sm text-amber-300">{notice}</p> : null}
    <div className="mt-auto flex min-h-[72px] flex-wrap items-center justify-between gap-3 bg-accent-500 px-6 py-4 text-primary-800">
      <PriceSummary regularPrice={cabin.regularPrice} discount={cabin.discount} quote={quote} />
      {range?.from || range?.to ? <button type="button" className="rounded-md border border-primary-800 px-4 py-2 text-sm font-semibold" onClick={() => { resetRange(); setNotice(""); }}>Clear dates</button> : null}
    </div>
  </section>;
}

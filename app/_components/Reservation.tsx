"use client";

import { useEffect, useState } from "react";
import DateSelector from "./DateSelector";
import ReservationForm from "./ReservationForm";
import LoginMessage from "./LoginMessage";
import { useGuestSession } from "./GuestSessionProvider";
import { reservationAvailabilitySchema, type ReservationAvailability } from "../_lib/guest-read-schema";
import { localDateFromDateOnly } from "../_lib/reservation-draft";

type AvailabilityState = { cabinId: number; data: ReservationAvailability | null; error: boolean };

export default function Reservation({ cabinId }: { cabinId: number }) {
  const session = useGuestSession();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AvailabilityState>({ cabinId, data: null, error: false });
  useEffect(() => {
    const controller = new AbortController();
    setState({ cabinId, data: null, error: false });
    const deadline = window.setTimeout(() => {
      setState({ cabinId, data: null, error: true });
      controller.abort();
    }, 15_000);
    async function load() {
      try {
        const response = await fetch(`/api/cabins/${cabinId}/availability`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const data = reservationAvailabilitySchema.parse(await response.json());
        if (data.cabin.id !== cabinId) throw new Error("Mismatched cabin");
        if (!controller.signal.aborted) setState({ cabinId, data, error: false });
      } catch {
        if (!controller.signal.aborted) setState({ cabinId, data: null, error: true });
      } finally {
        window.clearTimeout(deadline);
      }
    }
    void load();
    return () => { window.clearTimeout(deadline); controller.abort(); };
  }, [cabinId, attempt]);
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  if (state.cabinId !== cabinId || !state.data) {
    return <section id="reservation" className="border border-primary-800 p-8 min-h-[200px]" aria-label="Reservation">
      {state.cabinId === cabinId && state.error ? <>
        <p role="alert">Unable to load current availability. Please retry before reserving.</p>
        <button type="button" className="mt-4 underline text-accent-400" onClick={() => setAttempt(value => value + 1)}>Retry availability</button>
      </> : <p role="status">Loading current availability…</p>}
    </section>;
  }
  const { cabin, settings, bookedDates } = state.data;
  const currentCabin = { ...cabin, maxCapacity: Math.min(cabin.maxCapacity, settings.maxGuestsPerBooking) };
  const occupiedDates = bookedDates.map(localDateFromDateOnly);
  return <section id="reservation" aria-label="Reservation" className="grid grid-cols-1 xl:grid-cols-2 border border-primary-800 min-h-[400px]">
    <DateSelector settings={settings} bookedDates={occupiedDates} cabin={currentCabin} />
    {session.status === "loading" ? <p role="status" className="p-8">Checking login status…</p>
      : session.status === "error" ? <div className="p-8"><p role="alert">Unable to load your login status.</p>
        <button type="button" className="mt-4 underline text-accent-400" onClick={session.retry}>Retry login status</button></div>
        : session.user ? <ReservationForm cabin={currentCabin} user={session.user} settings={settings} bookedDates={occupiedDates} /> : <LoginMessage />}
  </section>;
}

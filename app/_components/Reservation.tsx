"use client";

import { useEffect, useState } from "react";
import DateSelector from "./DateSelector";
import ReservationForm from "./ReservationForm";
import LoginMessage from "./LoginMessage";
import { useGuestSession } from "./GuestSessionProvider";
import { reservationAvailabilitySchema, type ReservationAvailability } from "../_lib/guest-read-schema";
import { localDateFromDateOnly } from "../_lib/reservation-draft";
import Spinner from "./Spinner";
import SpinnerMini from "./SpinnerMini";

type AvailabilityState = { cabinId: number; data: ReservationAvailability | null; error: boolean; loading: boolean };

export default function Reservation({ cabinId }: { cabinId: number }) {
  const session = useGuestSession();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AvailabilityState>({ cabinId, data: null, error: false, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    // Keep the calendar mounted while refreshing so its visible month survives.
    setState(previous => ({ cabinId, data: previous.cabinId === cabinId ? previous.data : null, error: false, loading: true }));
    const deadline = window.setTimeout(() => {
      setState({ cabinId, data: null, error: true, loading: false });
      controller.abort();
    }, 15_000);
    async function load() {
      try {
        const response = await fetch(`/api/cabins/${cabinId}/availability`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const data = reservationAvailabilitySchema.parse(await response.json());
        if (data.cabin.id !== cabinId) throw new Error("Mismatched cabin");
        if (!controller.signal.aborted) setState({ cabinId, data, error: false, loading: false });
      } catch {
        if (!controller.signal.aborted) setState({ cabinId, data: null, error: true, loading: false });
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
    return <section id="reservation" className="border border-primary-800 p-8 min-h-[200px]" aria-label="Reservation" aria-busy={state.loading}>
      {state.cabinId === cabinId && state.error ? <>
        <p role="alert">Unable to load current availability. Please retry before reserving.</p>
        <button type="button" className="mt-4 underline text-accent-400" onClick={() => setAttempt(value => value + 1)}>Retry availability</button>
      </> : <div role="status" className="text-center"><span aria-hidden="true"><Spinner /></span><p>Loading current availability…</p></div>}
    </section>;
  }
  const { cabin, settings, bookedDates } = state.data;
  const currentCabin = { ...cabin, maxCapacity: Math.min(cabin.maxCapacity, settings.maxGuestsPerBooking) };
  const occupiedDates = bookedDates.map(localDateFromDateOnly);
  return <section id="reservation" aria-label="Reservation" aria-busy={state.loading} className="grid grid-cols-1 xl:grid-cols-2 border border-primary-800 min-h-[400px]">
    <div className="col-span-full flex items-center justify-between gap-3 border-b border-primary-800 px-6 py-3 text-sm">
      {state.loading ? <span role="status" className="flex items-center gap-2"><span aria-hidden="true"><SpinnerMini /></span>Refreshing availability…</span>
        : <span>Review the latest dates before reserving.</span>}
      <button type="button" disabled={state.loading} className="underline text-accent-400 disabled:opacity-50" onClick={() => setAttempt(value => value + 1)}>Refresh availability</button>
    </div>
    <DateSelector settings={settings} bookedDates={occupiedDates} cabin={currentCabin} />
    {state.loading || session.status === "loading" ? <div role="status" className="p-8 flex items-center justify-center gap-3"><span aria-hidden="true"><SpinnerMini /></span>{state.loading ? "Checking current dates…" : "Checking login status…"}</div>
      : session.status === "error" ? <div className="p-8"><p role="alert">Unable to load your login status.</p>
        <button type="button" className="mt-4 underline text-accent-400" onClick={session.retry}>Retry login status</button></div>
        : session.user ? <ReservationForm cabin={currentCabin} user={session.user} settings={settings} bookedDates={occupiedDates} /> : <LoginMessage />}
  </section>;
}

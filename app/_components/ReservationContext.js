"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createReservationDraft } from "../_lib/reservation-draft";

const ReservationContext = createContext();

const initialState = { from: undefined, to: undefined };

function ReservationProvider({ children }) {
  const [range, setRange] = useState(initialState);
  const [draft, setDraft] = useState(null);

  const resetRange = useCallback(() => {
    setRange(initialState);
    setDraft(null);
  }, []);

  const adoptDraft = useCallback((nextDraft) => {
    if (
      !Number.isInteger(nextDraft?.cabinId) ||
      !Number.isInteger(nextDraft?.numGuests) ||
      nextDraft.numGuests < 1
    ) {
      throw new Error("Reservation plan is incomplete");
    }

    const { draft: normalized, range: nextRange } = createReservationDraft(nextDraft);
    setDraft(normalized);
    setRange(nextRange);
  }, []);

  const value = useMemo(
    () => ({ range, setRange, resetRange, draft, adoptDraft }),
    [range, resetRange, draft, adoptDraft]
  );

  return (
    <ReservationContext.Provider value={value}>
      {children}
    </ReservationContext.Provider>
  );
}

function useReservation() {
  const context = useContext(ReservationContext);
  if (context === undefined)
    throw new Error("Context was used outside provider");
  return context;
}

export { ReservationProvider, useReservation };

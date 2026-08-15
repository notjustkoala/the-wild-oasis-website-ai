export type ReservationDraft = {
  cabinId: number;
  startDate: string;
  endDate: string;
  numGuests: number;
};

export function localDateFromDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) throw new Error("Reservation dates must use YYYY-MM-DD format");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    throw new Error("Reservation date is invalid");
  }
  return date;
}

export function createReservationDraft(nextDraft: ReservationDraft) {
  if (
    !Number.isInteger(nextDraft?.cabinId) ||
    !Number.isInteger(nextDraft?.numGuests) ||
    nextDraft.numGuests < 1
  ) {
    throw new Error("Reservation plan is incomplete");
  }
  const from = localDateFromDateOnly(nextDraft.startDate);
  const to = localDateFromDateOnly(nextDraft.endDate);
  if (to <= from) throw new Error("Checkout must be after check-in");

  return {
    draft: {
      cabinId: nextDraft.cabinId,
      startDate: nextDraft.startDate,
      endDate: nextDraft.endDate,
      numGuests: nextDraft.numGuests,
    },
    range: { from, to },
  };
}

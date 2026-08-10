import { privilegedSupabase } from "./supabase-server";

export const bookingRepository = {
  async getCabin(cabinId) {
    const { data, error } = await privilegedSupabase
      .from("cabins")
      .select("id, regularPrice, discount, maxCapacity")
      .eq("id", cabinId)
      .single();

    if (error) throw new Error("Cabin could not be loaded");
    return data;
  },

  async getSettings() {
    const { data, error } = await privilegedSupabase
      .from("settings")
      .select("minBookingLength, maxBookingLength, maxGuestsPerBooking")
      .single();

    if (error) throw new Error("Booking settings could not be loaded");
    return data;
  },

  async getOwnedBooking(bookingId, guestId) {
    const { data, error } = await privilegedSupabase
      .from("bookings")
      .select("id, cabinId, guestId")
      .eq("id", bookingId)
      .eq("guestId", guestId)
      .maybeSingle();

    if (error) throw new Error("Booking could not be loaded");
    return data;
  },

  async findConflicts({ cabinId, startDate, endDate }) {
    const { data, error } = await privilegedSupabase
      .from("bookings")
      .select("id")
      .eq("cabinId", cabinId)
      .lt("startDate", endDate)
      .gt("endDate", startDate)
      .neq("status", "cancelled");

    if (error) throw new Error("Cabin availability could not be verified");
    return data ?? [];
  },

  async insert(booking) {
    const { error } = await privilegedSupabase.from("bookings").insert([booking]);

    if (error) throw new Error("Booking could not be created");
  },

  async updateForGuest({ bookingId, guestId, changes }) {
    const { data, error } = await privilegedSupabase
      .from("bookings")
      .update(changes)
      .eq("id", bookingId)
      .eq("guestId", guestId)
      .select("id")
      .maybeSingle();

    if (error) throw new Error("Booking could not be updated");
    return data;
  },
};

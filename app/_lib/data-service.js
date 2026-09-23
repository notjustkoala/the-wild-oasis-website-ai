import { eachDayOfInterval, subDays } from "date-fns";

import { supabase } from "./supabase";
import { privilegedSupabase } from "./supabase-server";
import { notFound } from "next/navigation";
/////////////
// GET

export async function getCabin(id) {
  const { data, error } = await supabase
    .from("cabins")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error(error);
    notFound();
  }

  return data;
}
export async function getCabinPrice(id) {
  const { data, error } = await supabase
    .from("cabins")
    .select("regularPrice, discount")
    .eq("id", id)
    .single();

  if (error) {
    console.error(error);
  }

  return data;
}

export const getCabins = async function () {
  const { data, error } = await supabase
    .from("cabins")
    .select("id, name, maxCapacity, regularPrice, discount, image")
    .order("name");

  if (error) {
    console.error(error);
    throw new Error("Cabins could not be loaded");
  }

  return data;
};

// Guests are uniquely identified by their email address
export async function getGuest(email) {
  const { data } = await privilegedSupabase
    .from("guests")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  // No error here! We handle the possibility of no guest in the sign in callback
  return data;
}

export async function getBooking(id, guestId) {
  const { data, error } = await privilegedSupabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .eq("guestId", guestId)
    .single();

  if (error) {
    console.error(error);
    throw new Error("Booking could not get loaded");
  }

  return data;
}

export async function getBookings(guestId) {
  const { data, error } = await privilegedSupabase
    .from("bookings")
    // We actually also need data on the cabins as well. But let's ONLY take the data that we actually need, in order to reduce downloaded data.
    .select(
      "id, created_at, startDate, endDate, numNights, numGuests, totalPrice, status, guestId, cabinId, cabins(name, image)"
    )
    .eq("guestId", guestId)
    .order("startDate");

  if (error) {
    console.error(error);
    throw new Error("Bookings could not get loaded");
  }

  return data;
}

export async function getBookedDatesByCabinId(cabinId) {
  let today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  today = today.toISOString();

  // Getting all bookings
  const { data, error } = await supabase
    .from("bookings")
    .select("startDate, endDate, status, cabinId")
    .eq("cabinId", cabinId)
    .neq("status", "cancelled")
    .or(`startDate.gte.${today},status.eq.checked-in`);

  if (error) {
    console.error(error);
    throw new Error("Bookings could not get loaded");
  }

  // Converting to actual dates to be displayed in the date picker
  return getOccupiedDates(data);
}

function localDateFromDatabase(value) {
  const dateOnly = typeof value === "string" ? value.slice(0, 10) : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return new Date(Number.NaN);

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function getOccupiedDates(bookings) {
  return bookings
    .filter(
      (booking) =>
        booking.status !== "cancelled" &&
        localDateFromDatabase(booking.startDate) <
          localDateFromDatabase(booking.endDate)
    )
    .map((booking) => {
      return eachDayOfInterval({
        start: localDateFromDatabase(booking.startDate),
        end: subDays(localDateFromDatabase(booking.endDate), 1),
      });
    })
    .flat();
}

export async function getSettings() {
  const { data, error } = await supabase.from("settings").select("*").single();

  if (error) {
    console.error(error);
    throw new Error("Settings could not be loaded");
  }

  return data;
}

/////////////
// CREATE

export async function createGuest(newGuest) {
  const guest = {
    email: newGuest.email,
    fullName: newGuest.fullName,
  };
  const { data, error } = await privilegedSupabase
    .from("guests")
    .insert([guest]);

  if (error) {
    console.error(error);
    throw new Error("Guest could not be created");
  }

  return data;
}

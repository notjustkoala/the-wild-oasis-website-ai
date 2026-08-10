"use server";

import { revalidatePath } from "next/cache";
import { auth, signIn, signOut } from "./auth";
import { privilegedSupabase } from "./supabase-server";
import { getBookings } from "./data-service";
import { redirect } from "next/navigation";
import {
  createVerifiedBooking,
  updateVerifiedBooking,
} from "./booking-service";
import { bookingRepository } from "./booking-repository";

export async function updateGuest(formData) {
  const session = await auth();
  if (!session) throw new Error("You must be logged in");

  const nationalID = formData.get("nationalID");
  const [nationality, countryFlag] = formData.get("nationality").split("%");

  if (!/^[a-zA-Z0-9]{6,12}$/.test(nationalID))
    throw new Error("Please provide a valid national ID");

  const updateData = { nationality, countryFlag, nationalID };

  const { data, error } = await privilegedSupabase
    .from("guests")
    .update(updateData)
    .eq("id", session.user.guestId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new Error("Guest could not be updated");
  }

  revalidatePath("/account/profile");
}

export async function createBooking(formData) {
  const session = await auth();
  if (!session) throw new Error("You must be logged in");

  const booking = await createVerifiedBooking({
    input: {
      cabinId: formData.get("cabinId"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      numGuests: formData.get("numGuests"),
      observations: formData.get("observations"),
    },
    guestId: session.user.guestId,
    repository: bookingRepository,
  });

  revalidatePath(`/cabins/${booking.cabinId}`);

  redirect("/cabins/thankyou");
}

export async function deleteBooking(bookingId) {
  const session = await auth();
  if (!session) throw new Error("You must be logged in");

  //防止用户通过网络删除不是自己的booking
  const guestBookings = await getBookings(session.user.guestId);
  const guestBookingIds = guestBookings.map((booking) => booking.id);

  if (!guestBookingIds.includes(bookingId))
    throw new Error("You are not allowed to delete the booking");

  const { error } = await privilegedSupabase
    .from("bookings")
    .delete()
    .eq("id", bookingId)
    .eq("guestId", session.user.guestId);

  if (error) {
    throw new Error("Booking could not be deleted");
  }

  revalidatePath("/account/reservations");
}

export async function updateBooking(formData) {
  const session = await auth();
  if (!session) throw new Error("You must be logged in");

  const { bookingId } = await updateVerifiedBooking({
    input: {
      bookingId: formData.get("bookingId"),
      numGuests: formData.get("numGuests"),
      observations: formData.get("observations"),
    },
    guestId: session.user.guestId,
    repository: bookingRepository,
  });

  revalidatePath(`/account/reservations/edit/${bookingId}`);
  redirect("/account/reservations");
}

export async function signInAction() {
  await signIn("google", { redirectTo: "/account" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

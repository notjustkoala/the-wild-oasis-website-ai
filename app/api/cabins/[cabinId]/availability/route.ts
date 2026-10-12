import { supabase } from "@/app/_lib/supabase";
import { getBookedDatesByCabinId, getSettings } from "@/app/_lib/data-service";
import { reservationAvailabilitySchema } from "@/app/_lib/guest-read-schema";
import { toDateOnly } from "@/app/_lib/booking-domain";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: { params: { cabinId: string } }) {
  const cabinId = Number(params.cabinId);
  if (!/^[1-9]\d*$/.test(params.cabinId) || !Number.isSafeInteger(cabinId)) {
    return Response.json({ error: "Invalid cabin ID." }, { status: 400, headers });
  }
  try {
    const { data: cabin, error } = await supabase.from("cabins")
      .select("id, maxCapacity, regularPrice, discount").eq("id", cabinId).maybeSingle();
    if (error) throw new Error("Unavailable");
    if (!cabin) return Response.json({ error: "Cabin not found." }, { status: 404, headers });
    const [settings, bookedDates] = await Promise.all([
      getSettings(), getBookedDatesByCabinId(cabinId),
    ]);
    const data = reservationAvailabilitySchema.parse({ cabin, settings,
      bookedDates: bookedDates.map((date: Date) => toDateOnly(date)),
    });
    return Response.json(data, { headers });
  } catch {
    return Response.json({ error: "Unable to load current availability. Please retry." }, { status: 503, headers });
  }
}

import { getBookedDatesByCabinId, getCabin } from "@/app/_lib/data-service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request, { params }) {
  const { cabinId } = params;

  try {
    const [cabin, bookedDates] = await Promise.all([
      getCabin(cabinId),
      getBookedDatesByCabinId(cabinId),
    ]);
    return Response.json({ cabin, bookedDates }, { headers });
  } catch {
    return Response.json({ message: "Cabin data is unavailable." }, { status: 503, headers });
  }
}

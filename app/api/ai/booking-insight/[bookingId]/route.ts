import { createBookingInsightRouteHandlers } from "@/app/_ai/booking-insight-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handlers = createBookingInsightRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const OPTIONS = handlers.OPTIONS;

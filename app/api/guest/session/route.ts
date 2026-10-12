import { auth } from "@/app/_lib/auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  try {
    const session = await auth();
    return Response.json({ user: session?.user ? {
      name: session.user.name ?? null,
      image: session.user.image ?? null,
    } : null }, { headers });
  } catch {
    return Response.json({ error: "Unable to load your login status." }, { status: 503, headers });
  }
}

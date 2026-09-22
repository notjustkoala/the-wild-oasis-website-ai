import "server-only";

import { timingSafeEqual } from "node:crypto";
import { createPrivilegedSupabaseClient } from "@/app/_lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DISABLED = { ok: false, status: "disabled" } as const;
const UNAUTHORIZED = { ok: false, status: "unauthorized" } as const;
const UNAVAILABLE = { ok: false, status: "unavailable" } as const;

function json(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function isStrongCronSecret(value: string | undefined): value is string {
  return Boolean(
    value &&
      value.length >= 32 &&
      value.length <= 256 &&
      value.trim() === value
  );
}

function hasValidBearer(header: string | null, secret: string) {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(header, "utf8");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

function parseResetResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.status === "busy" && record.restoredCount === 0) {
    return { status: "busy" as const, restored: 0 };
  }
  if (
    record.status === "reset" &&
    Number.isSafeInteger(record.restoredCount) &&
    Number(record.restoredCount) > 0
  ) {
    return {
      status: "reset" as const,
      restored: Number(record.restoredCount),
    };
  }
  return null;
}

export async function GET(request: Request) {
  if (process.env.DEMO_RESET_ENABLED !== "true") {
    return json(DISABLED, 503);
  }

  const secret = process.env.CRON_SECRET;
  if (!isStrongCronSecret(secret)) {
    return json(UNAVAILABLE, 503);
  }
  if (!hasValidBearer(request.headers.get("authorization"), secret)) {
    return json(UNAUTHORIZED, 401);
  }

  try {
    const client = createPrivilegedSupabaseClient();
    const { data, error } = await client.rpc("reset_demo_bookings");
    if (error) return json(UNAVAILABLE, 503);

    const result = parseResetResult(data);
    if (!result) return json(UNAVAILABLE, 503);
    if (result.status === "busy") {
      return json({ ok: false, ...result }, 409);
    }
    return json({ ok: true, ...result }, 200);
  } catch {
    return json(UNAVAILABLE, 503);
  }
}

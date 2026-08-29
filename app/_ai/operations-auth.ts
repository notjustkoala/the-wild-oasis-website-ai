import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type OperationsAuthorization =
  | { ok: true; client: SupabaseClient; user: User; role: "admin" | "staff" }
  | { ok: false; status: 401 | 403 | 503; message: string };

function readBearer(request: Request) {
  const value = request.headers.get("authorization")?.trim();
  const match = value ? /^Bearer\s+([^\s]+)$/i.exec(value) : null;
  return match?.[1] ?? null;
}

export async function authorizeOperationsStaff(
  request: Request,
  dependencies: {
    env?: NodeJS.ProcessEnv;
    createClient?: typeof createClient;
  } = {}
): Promise<OperationsAuthorization> {
  const token = readBearer(request);
  if (!token) return { ok: false, status: 401, message: "Authentication is required." };

  const env = dependencies.env ?? process.env;
  const url = env.SUPABASE_URL?.trim();
  const key = (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_KEY)?.trim();
  if (!url || !key) return { ok: false, status: 503, message: "The operations service is not configured." };

  const factory = dependencies.createClient ?? createClient;
  const client = factory(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, message: "The session is invalid or expired." };

  const role = data.user.app_metadata?.role;
  if (role !== "admin" && role !== "staff") {
    return { ok: false, status: 403, message: "Staff access is required." };
  }
  return { ok: true, client, user: data.user, role };
}

export function operationsErrorResponse(error: unknown) {
  if (error instanceof Error && /date range|date is invalid|booking id|note/i.test(error.message)) {
    return { status: 400, body: { error: error.message } };
  }
  return { status: 503, body: { error: "The operations service is temporarily unavailable." } };
}

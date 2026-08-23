import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type AdminAuthorizationResult =
  | { ok: true; client: SupabaseClient; user: User }
  | { ok: false; status: 401 | 403 | 503; message: string };

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim();
  if (!value) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] ?? null;
}

export async function authorizeBookingInsightAdmin(
  request: Request,
  dependencies: {
    env?: NodeJS.ProcessEnv;
    createClient?: typeof createClient;
  } = {}
): Promise<AdminAuthorizationResult> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, status: 401, message: "Authentication is required." };
  }

  const env = dependencies.env ?? process.env;
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = (
    env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_KEY
  )?.trim();
  if (!url || !publishableKey) {
    return { ok: false, status: 503, message: "The insight service is not configured." };
  }

  const factory = dependencies.createClient ?? createClient;
  const client = factory(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, message: "The session is invalid or expired." };
  }
  if (data.user.app_metadata?.role !== "admin") {
    return { ok: false, status: 403, message: "Administrator access is required." };
  }

  return { ok: true, client, user: data.user };
}

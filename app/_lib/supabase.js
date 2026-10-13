import { createClient } from "@supabase/supabase-js";

let client;
let liveClient;

function getClient(fresh = false) {
  const existing = fresh ? liveClient : client;
  if (existing) return existing;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in environment variables."
    );
  }

  const created = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Keep the ISR reader in Next's cache context; live reads override upstream
    // caching explicitly without making static presentation dynamic.
    ...(fresh ? { global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) } } : {}),
  });
  if (fresh) liveClient = created;
  else client = created;
  return created;
}

export const supabase = {
  from(...args) {
    return getClient().from(...args);
  },
  rpc(...args) {
    return getClient().rpc(...args);
  },
};

export const liveSupabase = {
  from(...args) {
    return getClient(true).from(...args);
  },
};

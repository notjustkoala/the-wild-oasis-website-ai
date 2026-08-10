import "server-only";

import { createClient } from "@supabase/supabase-js";

let privilegedClient;

export function resolvePrivilegedSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL must be configured for server data access");
  }
  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY must be configured for privileged server data access"
    );
  }

  const publicKeys = [env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_KEY].filter(Boolean);
  if (publicKeys.includes(secretKey)) {
    throw new Error("A publishable key cannot be used for privileged server data access");
  }

  return { url, secretKey };
}

export function createPrivilegedSupabaseClient({
  env = process.env,
  clientFactory = createClient,
} = {}) {
  const { url, secretKey } = resolvePrivilegedSupabaseConfig(env);
  return clientFactory(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function getPrivilegedClient() {
  if (!privilegedClient) {
    privilegedClient = createPrivilegedSupabaseClient();
  }
  return privilegedClient;
}

export const privilegedSupabase = {
  from(...args) {
    return getPrivilegedClient().from(...args);
  },
};

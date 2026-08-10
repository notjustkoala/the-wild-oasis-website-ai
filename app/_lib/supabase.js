import { createClient } from "@supabase/supabase-js";

let client;

function getClient() {
  if (client) return client;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in environment variables."
    );
  }

  client = createClient(supabaseUrl, supabaseKey);
  return client;
}

export const supabase = {
  from(...args) {
    return getClient().from(...args);
  },
};

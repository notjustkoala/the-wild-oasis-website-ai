import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const [emailArgument, roleArgument] = process.argv.slice(2);
const email = emailArgument?.trim().toLocaleLowerCase();
const role = roleArgument?.trim().toLocaleLowerCase();

async function main() {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Provide one valid user email.");
  }
  if (role !== "staff" && role !== "admin") {
    throw new Error("Role must be staff or admin.");
  }

  for (const file of [".env.development.local", ".env.local"]) {
    try {
      process.loadEnvFile(file);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!url || !secretKey) {
    throw new Error("SUPABASE_URL and a server-only Supabase secret are required.");
  }

  const proxyUrl = [
    process.env.AI_HTTPS_PROXY,
    process.env.HTTPS_PROXY,
    process.env.HTTP_PROXY,
    process.env.https_proxy,
    process.env.http_proxy,
  ]
    .map((value) => value?.trim())
    .find(Boolean);
  let customFetch = globalThis.fetch;
  if (proxyUrl) {
    const parsedProxy = new URL(proxyUrl);
    if (!["http:", "https:"].includes(parsedProxy.protocol)) {
      throw new Error("The configured network proxy is not supported.");
    }
    const dispatcher = new ProxyAgent(parsedProxy.toString());
    customFetch = (input, init) =>
      undiciFetch(input, { ...init, dispatcher });
  }

  const supabase = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: customFetch },
  });

  let matchedUser;
  for (let page = 1; page <= 100 && !matchedUser; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw new Error("Supabase Auth users could not be read.");
    const matches = data.users.filter(
      (user) => user.email?.toLocaleLowerCase() === email
    );
    if (matches.length > 1) {
      throw new Error("More than one Supabase Auth user has the requested email.");
    }
    matchedUser = matches[0];
    if (data.users.length < 100) break;
  }

  if (!matchedUser) {
    throw new Error("No Supabase Auth user exists for the requested email.");
  }

  const appMetadata = {
    ...matchedUser.app_metadata,
    role,
  };
  const { data, error } = await supabase.auth.admin.updateUserById(
    matchedUser.id,
    { app_metadata: appMetadata }
  );
  if (error || !data.user) {
    throw new Error("The Supabase Auth user role could not be updated.");
  }

  console.log(
    JSON.stringify({
      updated: true,
      userId: data.user.id,
      role: data.user.app_metadata?.role ?? null,
      sessionRefreshRequired: true,
    })
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "The Supabase Auth user role could not be updated."
  );
  process.exitCode = 1;
});

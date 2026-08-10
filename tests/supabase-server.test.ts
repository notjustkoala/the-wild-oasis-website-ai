// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createPrivilegedSupabaseClient,
  resolvePrivilegedSupabaseConfig,
} from "../app/_lib/supabase-server";

const url = "https://test-project.supabase.co";

describe("privileged Supabase server client", () => {
  it("fails closed when the server secret is absent", () => {
    expect(() =>
      resolvePrivilegedSupabaseConfig({
        NODE_ENV: "test",
        SUPABASE_URL: url,
        SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      })
    ).toThrow("SUPABASE_SECRET_KEY must be configured");
  });

  it("never accepts a publishable or legacy anon key as the privileged key", () => {
    expect(() =>
      resolvePrivilegedSupabaseConfig({
        NODE_ENV: "test",
        SUPABASE_URL: url,
        SUPABASE_SECRET_KEY: "same-key",
        SUPABASE_PUBLISHABLE_KEY: "same-key",
      })
    ).toThrow("publishable key cannot be used");

    expect(() =>
      resolvePrivilegedSupabaseConfig({
        NODE_ENV: "test",
        SUPABASE_URL: url,
        SUPABASE_SERVICE_ROLE_KEY: "legacy-anon",
        SUPABASE_KEY: "legacy-anon",
      })
    ).toThrow("publishable key cannot be used");
  });

  it("passes only the server secret to a non-persistent Supabase client", () => {
    const client = { from: vi.fn() };
    const clientFactory = vi.fn().mockReturnValue(client);

    const result = createPrivilegedSupabaseClient({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: url,
        SUPABASE_SECRET_KEY: "server-secret-test-value",
        SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      },
      clientFactory,
    });

    expect(result).toBe(client);
    expect(clientFactory).toHaveBeenCalledWith(url, "server-secret-test-value", {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    expect(clientFactory).not.toHaveBeenCalledWith(
      expect.anything(),
      "public-test-key",
      expect.anything()
    );
  });

  it("marks the module server-only and contains no publishable fallback expression", async () => {
    const source = await readFile(
      resolve(process.cwd(), "app/_lib/supabase-server.js"),
      "utf8"
    );

    expect(source).toMatch(/^import "server-only";/);
    expect(source).toContain(
      "env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY"
    );
    expect(source).not.toMatch(
      /SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)[^;\n]*\|\|[^;\n]*SUPABASE_(?:PUBLISHABLE_KEY|KEY)/
    );
  });
});

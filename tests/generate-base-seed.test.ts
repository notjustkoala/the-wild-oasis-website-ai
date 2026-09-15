// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BASE_CABINS,
  BASE_GUESTS,
  BASE_IMAGE_URL_TOKEN,
  BASE_SETTINGS,
  buildBaseSeedSummary,
  normalizeImageBaseUrl,
  parseBaseSeedCliArgs,
  renderBaseSeedSql,
  resolveBaseSeedOutputPath,
} from "../scripts/generate-base-seed.mjs";
import { generateDemoData, renderSeedSql } from "../scripts/generate-demo-data.mjs";

describe("base seed generator", () => {
  it("has deterministic fixed IDs, expected row counts, and unique guest emails", () => {
    expect(BASE_CABINS.map((cabin) => cabin.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(BASE_GUESTS.map((guest) => guest.id)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1)
    );
    expect(new Set(BASE_GUESTS.map((guest) => guest.email))).toHaveLength(30);
    expect(BASE_SETTINGS.id).toBe(1);
    expect(buildBaseSeedSummary()).toEqual(
      expect.objectContaining({
        cabins: 8,
        settings: 1,
        guests: 30,
        uniqueGuestEmails: 30,
        checksum: "d95efa21bfc07caf74af1bd21a87bffff76308f8f29434e4536c5ef8653889c7",
      })
    );
  });

  it("renders a transactional allow-listed template with sequence and row-count checks", () => {
    const first = renderBaseSeedSql();
    const second = renderBaseSeedSql();

    expect(first).toBe(second);
    expect(first).toContain("begin;");
    expect(first).toContain("commit;");
    expect(first).toContain(
      '(id, name, "maxCapacity", "regularPrice", discount, image, description)'
    );
    expect(first).toContain(
      '(id, "fullName", email, "nationalID", nationality, "countryFlag")'
    );
    expect(first).toContain(BASE_IMAGE_URL_TOKEN);
    expect(first).toContain("pg_get_serial_sequence('public.cabins', 'id')");
    expect(first).toContain("expected exactly 30 guests");
    expect(first).not.toMatch(/sb_(secret|publishable)_/i);
    expect(first).not.toMatch(/[a-z0-9]{20}\.supabase\.co/i);
  });

  it("keeps the committed base SQL byte-for-byte synchronized with the canonical template", async () => {
    const committed = await readFile(
      resolve(process.cwd(), "supabase/base-seed.sql"),
      "utf8"
    );
    const generated = renderBaseSeedSql({
      imageBaseUrl: BASE_IMAGE_URL_TOKEN,
    });

    expect(committed).toBe(generated);
  });

  it("strictly renders only a Supabase public cabin-images target", () => {
    const imageBaseUrl =
      "https://test-project.supabase.co/storage/v1/object/public/cabin-images/";
    const sql = renderBaseSeedSql({ imageBaseUrl });

    expect(sql).toContain(
      "https://test-project.supabase.co/storage/v1/object/public/cabin-images/cabin-001.jpg"
    );
    expect(sql).not.toContain(BASE_IMAGE_URL_TOKEN);
    expect(() => normalizeImageBaseUrl("http://test-project.supabase.co/storage/v1/object/public/cabin-images"))
      .toThrow("HTTPS public cabin-images URL");
    expect(() => normalizeImageBaseUrl("https://example.com/storage/v1/object/public/cabin-images"))
      .toThrow("HTTPS public cabin-images URL");
    expect(() => normalizeImageBaseUrl("https://test-project.supabase.co/storage/v1/object/public/other"))
      .toThrow("HTTPS public cabin-images URL");
  });

  it("blocks remote apply flags and keeps rendered target files out of the versioned path", () => {
    expect(() => parseBaseSeedCliArgs(["--remote"])).toThrow(
      "Remote database writes are intentionally unsupported"
    );
    expect(() => parseBaseSeedCliArgs(["--project-ref=production"])).toThrow(
      "Remote database writes are intentionally unsupported"
    );
    expect(() => resolveBaseSeedOutputPath("C:\\repo", "..\\base.sql")).toThrow(
      "Output must"
    );

    expect(resolveBaseSeedOutputPath("C:\\repo", "supabase\\base-seed.sql"))
      .toEqual(expect.objectContaining({ isVersionedTemplate: true }));
    expect(resolveBaseSeedOutputPath("C:\\repo", "supabase\\generated\\dev.sql"))
      .toEqual(expect.objectContaining({ isVersionedTemplate: false }));
  });

  it("is compatible with every FK and active half-open range in the 800-booking seed", () => {
    const { bookings } = generateDemoData();
    const cabinIds = new Set(BASE_CABINS.map((cabin) => cabin.id));
    const guestIds = new Set(BASE_GUESTS.map((guest) => guest.id));
    const activeByCabin = new Map<number, typeof bookings>();

    for (const booking of bookings) {
      expect(cabinIds.has(booking.cabinId)).toBe(true);
      expect(guestIds.has(booking.guestId)).toBe(true);
      if (booking.status === "cancelled") continue;
      const stays = activeByCabin.get(booking.cabinId) ?? [];
      for (const stay of stays) {
        expect(
          booking.startDate < stay.endDate && stay.startDate < booking.endDate
        ).toBe(false);
      }
      stays.push(booking);
      activeByCabin.set(booking.cabinId, stays);
    }

    const sql = renderSeedSql(bookings);
    const exactCabinIds = `array[${BASE_CABINS.map(({ id }) => id).join(", ")}]::bigint[]`;
    const exactGuestIds = `array[${BASE_GUESTS.map(({ id }) => id).join(", ")}]::bigint[]`;
    expect(sql).toContain("Bookings seed requires exactly cabin IDs 1-8");
    expect(sql).toContain(
      `(select array_agg(id order by id) from public.cabins)\n    is distinct from ${exactCabinIds}`
    );
    expect(sql).toContain(
      `(select array_agg(id order by id) from public.guests)\n    is distinct from ${exactGuestIds}`
    );
    expect(sql).toContain(
      "(select array_agg(id order by id) from public.settings)\n    is distinct from array[1]::bigint[]"
    );
    expect(sql).not.toContain("id between");
    expect(sql).toContain("Bookings seed row-count verification failed");
    expect(sql).not.toMatch(/service[_-]?role|sb_secret_|[a-z0-9]{20}\.supabase\.co/i);
  });
});

describe("database bootstrap migration", () => {
  it("uses explicit grants, admin app_metadata RLS, and a half-open exclusion constraint", async () => {
    const migration = await readFile(
      resolve(
        process.cwd(),
        "supabase/migrations/20260806143548_dev_database_bootstrap.sql"
      ),
      "utf8"
    );

    expect(migration).toContain("create extension if not exists btree_gist");
    expect(migration).toContain("tstzrange(\"startDate\", \"endDate\", '[)') with &&");
    expect(migration).toContain('grant select ("startDate", "endDate", status, "cabinId")');
    expect(migration).toContain("auth.jwt() -> 'app_metadata' ->> 'role'");
    expect(migration).toContain("create policy cabin_images_admin_update");
    expect(migration).toContain("bucket_id = 'cabin-images'");
    expect(migration).not.toContain("user_metadata");
    expect(migration).not.toContain("auth.role()");
    expect(migration).not.toContain("security definer");
  });

  it("optimizes every business admin policy with an initplan-safe app_metadata check", async () => {
    const migration = await readFile(
      resolve(
        process.cwd(),
        "supabase/migrations/20260806145024_optimize_admin_rls_initplan.sql"
      ),
      "utf8"
    );
    const policies = [
      ["cabins_admin_all", "cabins"],
      ["guests_admin_all", "guests"],
      ["settings_admin_all", "settings"],
      ["bookings_admin_all", "bookings"],
    ];
    const initplanSafeAdminCheck =
      "((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'";

    for (const [policy, table] of policies) {
      const start = migration.indexOf(`alter policy ${policy}`);
      const end = migration.indexOf(";", start);
      const statement = migration.slice(start, end + 1);

      expect(start).toBeGreaterThanOrEqual(0);
      expect(statement).toContain(`on public.${table}`);
      expect(statement).toContain(`using (${initplanSafeAdminCheck})`);
      expect(statement).toContain(`with check (${initplanSafeAdminCheck})`);
      expect(statement.match(/\(select auth\.jwt\(\)\)/g)).toHaveLength(2);
      expect(statement.replaceAll("(select auth.jwt())", "")).not.toContain(
        "auth.jwt()"
      );
      expect(statement).not.toMatch(/\bto\s+(anon|authenticated|service_role)\b/i);
    }

    expect(migration).not.toMatch(/\b(drop|create)\s+policy\b/i);
    expect(migration).not.toContain("user_metadata");
    expect(migration).not.toContain("auth.role()");
  });
});

// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function migrationSql() {
  const directory = resolve(process.cwd(), "supabase/migrations");
  const name = (await readdir(directory)).find((entry) =>
    entry.endsWith("_add_safe_demo_reset.sql")
  );
  if (!name) throw new Error("safe demo reset migration is missing");
  return readFile(resolve(directory, name), "utf8");
}

describe("safe demo reset migration contract", () => {
  it("keeps the baseline private and the public RPC service-role-only", async () => {
    const sql = await migrationSql();
    expect(sql.match(/add column demo_dataset_id/g)).toHaveLength(1);
    expect(
      sql.match(/create table private\.demo_booking_baseline/g)
    ).toHaveLength(1);
    expect(sql).toContain("create table private.demo_booking_baseline");
    expect(sql).toContain(
      "alter table private.demo_booking_baseline enable row level security"
    );
    expect(sql).toContain(
      "revoke all privileges on table private.demo_booking_baseline"
    );
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke all on function public.reset_demo_bookings()"
    );
    expect(sql).toContain(
      "grant execute on function public.reset_demo_bookings() to service_role"
    );
    expect(sql).toContain(
      "grant usage, select, update on sequence public.bookings_id_seq to service_role"
    );
    expect(sql).not.toMatch(
      /grant [^;]*update[^;]* on sequence public\.bookings_id_seq to (?:public|anon|authenticated)/i
    );
  });

  it("locks, targets only fixed provenance, and avoids destructive broad SQL", async () => {
    const sql = await migrationSql();
    expect(sql).toContain(
      "pg_catalog.pg_try_advisory_xact_lock(20260922, 60803)"
    );
    expect(sql.indexOf("pg_try_advisory_xact_lock")).toBeLessThan(
      sql.indexOf("delete from public.bookings")
    );
    expect(sql).toContain("'status', 'busy'");
    expect(sql).toContain(
      "where demo_dataset_id = v_dataset"
    );
    expect(sql).toContain(
      "demo_dataset_id = 'wild-oasis-demo-20260803-v1'"
    );
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/delete from public\.bookings\s*;/i);
  });

  it("prevents authenticated callers from forging provenance", async () => {
    const sql = await migrationSql();
    expect(sql).toContain(
      "revoke insert, update on table public.bookings from authenticated"
    );
    const authenticatedGrantBlock = sql.match(
      /grant insert \(([\s\S]*?)\) on table public\.bookings to authenticated;/
    )?.[1];
    expect(authenticatedGrantBlock).toBeTruthy();
    expect(authenticatedGrantBlock).not.toContain("demo_dataset_id");
  });

  it("ships an executable rollback-only SQL verification suite", async () => {
    const sql = await readFile(
      resolve(process.cwd(), "supabase/tests/demo_reset.sql"),
      "utf8"
    );
    expect(sql).toContain("has_function_privilege");
    expect(sql).toContain(
      "has_sequence_privilege('service_role', 'public.bookings_id_seq', 'UPDATE')"
    );
    expect(sql).toContain("repeated reset is not idempotent");
    expect(sql).toContain("non-demo booking was modified or deleted");
    expect(sql).toContain("failed reset did not roll back its demo delete");
    expect(sql.trimEnd()).toMatch(/rollback;$/);
  });
});

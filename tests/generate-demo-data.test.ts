// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEMO_BOOKING_COUNT,
  DEMO_DATASET_ID,
  DEMO_MONTHS,
  DEMO_SEED,
  generateDemoData,
  parseCliArgs,
  renderSeedSql,
  resolveLocalOutputPath,
  runCli,
} from "../scripts/generate-demo-data.mjs";

describe("demo data generator", () => {
  it("generates the same 800-booking, 12-month dataset for the fixed seed", () => {
    const first = generateDemoData();
    const second = generateDemoData({ seed: DEMO_SEED });

    expect(first.bookings).toHaveLength(DEMO_BOOKING_COUNT);
    expect(new Set(first.bookings.map((booking) => booking.demoDatasetId))).toEqual(
      new Set([DEMO_DATASET_ID])
    );
    expect(DEMO_MONTHS).toBe(12);
    expect(Object.keys(first.summary.byMonth)).toHaveLength(DEMO_MONTHS);
    expect(Object.values(first.summary.byMonth)).not.toContain(0);
    expect(first.summary.checksum).toBe(second.summary.checksum);
    expect(first.bookings).toEqual(second.bookings);
  });

  it("contains every fixed special-request and security-evaluation category", () => {
    const { summary } = generateDemoData();

    expect(summary.bySpecialRequest).toEqual(
      expect.objectContaining({
        allergy: expect.any(Number),
        "late-arrival": expect.any(Number),
        pet: expect.any(Number),
        anniversary: expect.any(Number),
        "extra-bed": expect.any(Number),
        empty: expect.any(Number),
        "prompt-injection": expect.any(Number),
      })
    );
  });

  it("rejects remote modes and output paths outside local generated folders", () => {
    expect(() => parseCliArgs(["--apply"])).toThrow(
      "Remote database writes are intentionally unsupported"
    );
    expect(() => parseCliArgs(["--project-ref=production"])).toThrow(
      "Remote database writes are intentionally unsupported"
    );
    expect(() => parseCliArgs(["--target=production"])).toThrow(
      "Only the local Supabase target is supported"
    );
    expect(() => parseCliArgs(["--db-url=postgresql://production"])).toThrow(
      "Remote database writes are intentionally unsupported"
    );
    expect(() =>
      resolveLocalOutputPath("C:\\repo", "..\\seed.json")
    ).toThrow("Output must");
  });

  it("renders transaction SQL with a local target, escaping, and an explicit allowlist", () => {
    const booking = {
      ...generateDemoData().bookings[0],
      observations: "O'Malley needs a quiet room",
      maliciousExtraColumn: "do not serialize",
    };

    const sql = renderSeedSql([booking]);

    expect(sql).toContain(
      "Target: local Supabase only (postgresql://127.0.0.1:54322/postgres)"
    );
    expect(sql).toContain("begin;");
    expect(sql).toContain("commit;");
    expect(sql).toContain("O''Malley needs a quiet room");
    expect(sql).not.toContain("maliciousExtraColumn");
    expect(sql).not.toContain('"demoRef"');
    expect(sql).toContain('"cabinId", "guestId", "demo_dataset_id"');
    expect(sql).toContain(
      "insert into private.demo_booking_baseline"
    );
    expect(sql).toContain(
      "Bookings seed requires an empty demo booking baseline"
    );
    expect(sql).toContain(DEMO_DATASET_ID);
  });

  it("refuses to render bookings whose demo provenance is missing or changed", () => {
    const booking = generateDemoData().bookings[0];
    expect(() =>
      renderSeedSql([{ ...booking, demoDatasetId: null }])
    ).toThrow("fixed demo dataset provenance");
    expect(() =>
      renderSeedSql([{ ...booking, demoDatasetId: "another-dataset" }])
    ).toThrow("fixed demo dataset provenance");
  });

  it("keeps the committed booking SQL byte-for-byte synchronized with the canonical generator", async () => {
    const committed = await readFile(
      resolve(process.cwd(), "supabase/seed.sql"),
      "utf8"
    );
    const generated = renderSeedSql(
      generateDemoData({
        seed: DEMO_SEED,
        count: DEMO_BOOKING_COUNT,
      }).bookings
    );

    expect(committed).toBe(generated);
  });

  it("shows the local target in the default dry-run summary", async () => {
    let output = "";
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        output += String(chunk);
        return true;
      });

    try {
      const summary = await runCli(["--dry-run"]);
      expect(summary.target).toEqual({
        kind: "local",
        databaseUrl: "postgresql://127.0.0.1:54322/postgres",
      });
      expect(output).toContain('"kind": "local"');
    } finally {
      write.mockRestore();
    }
  });
});

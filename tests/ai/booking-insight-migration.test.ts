import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("booking insight migration contract", () => {
  const originalMigration =
    "supabase/migrations/20260816124054_booking_ai_insights.sql";
  const optimizationMigration =
    "supabase/migrations/20260816124854_optimize_booking_ai_insight_rls_initplan.sql";
  const serviceRoleReadMigration =
    "supabase/migrations/20260922160617_grant_service_role_ai_insight_read.sql";
  const sql = readFileSync(
    join(
      process.cwd(),
      originalMigration
    ),
    "utf8"
  );
  const optimizationSql = readFileSync(
    join(process.cwd(), optimizationMigration),
    "utf8"
  );
  const serviceRoleReadSql = readFileSync(
    join(process.cwd(), serviceRoleReadMigration),
    "utf8"
  );

  it("uses a booking primary key, traceability fields and RLS", () => {
    expect(sql).toMatch(/booking_id bigint primary key/i);
    expect(sql).toMatch(/result jsonb/i);
    expect(sql).toMatch(/model text not null/i);
    expect(sql).toMatch(/prompt_version text not null/i);
    expect(sql).toMatch(/source_hash text not null/i);
    expect(sql).toMatch(/reviewer_feedback jsonb/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).not.toMatch(/to anon/i);
  });

  it("uses atomic invoker claims, generation tokens and least privilege", () => {
    expect(sql).toMatch(
      /on conflict on constraint booking_ai_insights_pkey do update/i
    );
    expect(sql).not.toMatch(/on conflict \(booking_id\)/i);
    expect(sql).toMatch(/security invoker/gi);
    expect(sql).toMatch(/generation_token/i);
    expect(sql).toMatch(/existing\.status = 'pending'[\s\S]*interval '2 minutes'/i);
    expect(sql).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function[\s\S]*to authenticated/i);
    expect(sql).not.toMatch(/security definer/i);
  });

  it("keeps the applied migration immutable and orders the optimization later", () => {
    expect(
      createHash("sha256")
        .update(sql.replace(/\r\n/g, "\n"))
        .digest("hex")
        .toUpperCase()
    ).toBe("54B0DCC092AD38B8A5733363AF7994F4B53D451F11CA2B92FB6173FDF1CD286A");
    expect(originalMigration.localeCompare(optimizationMigration)).toBeLessThan(0);
  });

  it("recreates all three admin policies with a statement-level JWT initplan", () => {
    expect(
      optimizationSql.match(/drop policy if exists booking_ai_insights_admin_/gi)
    ).toHaveLength(3);
    expect(
      optimizationSql.match(/create policy booking_ai_insights_admin_/gi)
    ).toHaveLength(3);
    expect(optimizationSql).toMatch(/for select\s+to authenticated\s+using/i);
    expect(optimizationSql).toMatch(/for insert\s+to authenticated\s+with check/i);
    expect(optimizationSql).toMatch(
      /for update\s+to authenticated\s+using[\s\S]*with check/i
    );
    expect(
      optimizationSql.match(
        /\(\(select auth\.jwt\(\)\) -> 'app_metadata' ->> 'role'\) = 'admin'/g
      )
    ).toHaveLength(4);
    expect(optimizationSql).not.toMatch(/\(select auth\.jwt\(\) ->/i);
  });

  it("gives the service-only reset verification read access without widening clients", () => {
    expect(
      serviceRoleReadSql.match(
        /grant select on table public\.booking_ai_insights to service_role/gi
      )
    ).toHaveLength(1);
    expect(serviceRoleReadSql).not.toMatch(/\bto\s+(?:public|anon|authenticated)\b/i);
    expect(serviceRoleReadSql).not.toMatch(/\b(?:insert|update|delete)\b/i);
  });
});

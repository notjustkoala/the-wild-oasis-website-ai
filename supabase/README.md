# Dev database bootstrap

This directory contains a reviewed schema migration and deterministic seed
generators. None of the scripts connects to Supabase or supports a remote
apply mode. The quoted camelCase SQL identifiers are a temporary compatibility
contract for the two existing frontends; new standalone database designs
should use snake_case.

The only supported initialization order is:

1. Apply `migrations/20260805162245_dev_database_bootstrap.sql`.
2. Render and apply the base seed (8 cabins, settings `id=1`, 30 guests).
3. Upload `cabin-001.jpg` through `cabin-008.jpg` to `cabin-images`.
4. Apply `seed.sql` to add the deterministic 800 bookings.

Remote schema/seed execution is allowed only after explicit user authorization
and only through the reviewed migration/database tool. Do not add `--linked`,
`--project-ref`, `--db-url`, `--remote`, or a production target to these
generators; they reject remote flags. Never put a project secret in a command,
SQL file, source file, screenshot, log, or chat.

## 1. Schema

The migration creates the four public tables, constraints, indexes,
`btree_gist` half-open booking exclusion constraint, explicit Data API grants,
RLS policies, and the public `cabin-images` bucket. Anonymous access is limited
to cabins, settings, and the four booking availability columns. Admin browser
access requires `app_metadata.role = admin`; editable `user_metadata` is never
used. Customer private access uses the server-only Supabase secret.

## 2. Base seed

Preview/validate the stable source without writing a file:

```bash
npm run seed:base -- --dry-run
```

Regenerate the committed portable template:

```bash
npm run seed:base -- --write --output=supabase/base-seed.sql
```

The committed template contains `__CABIN_IMAGE_BASE_URL__`, not a project ref.
For an explicitly authorized Dev initialization, render a target-specific copy
only inside the ignored `supabase/generated/` directory:

```bash
npm run seed:base -- --image-base-url=https://YOUR_DEV_REF.supabase.co/storage/v1/object/public/cabin-images --write --output=supabase/generated/base-seed.dev.sql
```

The renderer only accepts the HTTPS Supabase public URL for the exact bucket.
It refuses to put a target URL into the committed template. The SQL requires
empty target tables, uses explicit column allowlists, resets identity
sequences, verifies all row counts and unique emails, and runs in one
transaction.

## 3. Cabin images

After the base rows exist, upload the eight existing source images from the
admin app's `src/data/cabins/` directory. Keep the exact object names
`cabin-001.jpg` through `cabin-008.jpg`. The bucket is publicly readable by URL;
listing and mutations remain protected. Storage upsert is available only to an
authenticated JWT whose `app_metadata.role` is `admin` and has SELECT, INSERT,
and UPDATE policies.

## 4. Deterministic bookings

Preview the fixed seed and target declaration:

```bash
npm run seed:demo -- --dry-run --target=local
```

Regenerate the committed SQL (800 bookings across the fixed 12-month window):

```bash
npm run seed:demo -- --target=local --format=sql --write --output=supabase/seed.sql
```

The booking seed requires exact cabin IDs 1-8, guest IDs 1-30, settings
`id=1`, and an empty bookings table. It uses an explicit column allowlist,
escapes strings, resets the booking identity sequence, verifies the inserted
row count, and runs in one transaction. Non-cancelled generated stays do not
overlap, so they satisfy the database exclusion constraint.

For a local Supabase instance, the reviewed files can be inspected/applied with
local tooling after the CLI is available. Remote execution is deliberately not
embedded in npm scripts or generators.

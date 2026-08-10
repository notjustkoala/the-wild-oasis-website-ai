# The Wild Oasis Website

Next.js guest website for cabin discovery, authentication, reservations, and
account management. This Worktree is isolated from the existing application
and should point only to a dedicated development Supabase project.

## Local setup

Requirements: Node.js 20+ and npm.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Required variables are documented in `.env.example`:

- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server runtime only)
- `NEXTAUTH_SECRET`
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`

`SUPABASE_KEY` is a compatibility fallback for a legacy low-privilege anon
key. `SUPABASE_SERVICE_ROLE_KEY` is accepted only as a legacy server-only
fallback for `SUPABASE_SECRET_KEY`. The privileged key must never use a
`NEXT_PUBLIC_` prefix, enter a Client Component, appear in logs/chat, or be
committed. Local environment files are ignored by Git.

Cabins, settings, and the minimum availability columns use the publishable
client. Guest profiles, private reservation history, ownership-checked
mutations, and the trusted booking repository use a separate `server-only`
client that fails closed when the secret is absent; it never falls back to a
publishable key.

The root layout uses the committed Geist variable font, so production builds
do not download Google Fonts. Data-backed cabin pages are rendered dynamically,
so `next build` does not query Supabase.

## Quality commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run check
```

Vitest tests use mocks and pure dependencies; they do not connect to Supabase.
New `.ts`/`.tsx` modules are checked without migrating stable JavaScript.

## Trusted reservation flow

The browser submits only cabin ID, start/end dates, guest count, and optional
observations. The server reloads cabin price/capacity and booking settings,
validates the stay, checks current half-open date ranges, recalculates
`nights * (regularPrice - discount)`, and then inserts an allow-listed object.
A checkout date can be reused as the next booking's check-in date.

The final availability check and insert are two database requests, but the
reviewed database migration adds a GiST exclusion constraint on each cabin's
non-cancelled `[startDate, endDate)` range. The database therefore rejects a
concurrent overlapping insert even if both application checks initially pass.

## Deterministic demo data

Preview the fixed `20260803` seed (800 bookings over 12 months):

```bash
npm run seed:demo -- --dry-run
```

To create a local JSON artifact explicitly:

```bash
npm run seed:demo -- --write --output supabase/generated/demo-data.json
```

The generator models seasonality, stay price, lead time, cancellation/status,
breakfast, and fixed special-request categories (including an adversarial
prompt sample). It has no remote write mode and restricts output to local
generated-data folders. See `supabase/README.md` before any future import.

The database keeps quoted legacy camelCase columns because both existing
frontends already consume that API. This is a deliberate compatibility
exception to the normal Postgres snake_case convention; any rename must be a
separate versioned API migration.

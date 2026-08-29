# The Wild Oasis Website

Next.js guest website for cabin discovery, authentication, reservations, and
account management. This Worktree is isolated from the existing application
and should point only to a dedicated development Supabase project.

## Local setup

Requirements: Node.js 22+ and npm.

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
- `AI_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` for live AI concierge
  requests (server runtime only)
- optional `AI_CONCIERGE_MODEL`; it defaults to `gemini-3.6-flash`

`SUPABASE_KEY` is a compatibility fallback for a legacy low-privilege anon
key. `SUPABASE_SERVICE_ROLE_KEY` is accepted only as a legacy server-only
fallback for `SUPABASE_SECRET_KEY`. The privileged key must never use a
`NEXT_PUBLIC_` prefix, enter a Client Component, appear in logs/chat, or be
committed. Local environment files are ignored by Git.

## AI concierge

The global **Ask AI concierge** launcher streams an AI SDK `ToolLoopAgent`.
It calls the Gemini Developer API directly by default, using the stable
`gemini-3.6-flash` model because it supports streaming and function calling and
is available to the development account used for this project. This does not
guarantee that 3.6 Flash has free quota for every account. Model availability,
free-tier quotas, regional availability, and verification requirements can
change; check the model list and limits shown by Google AI Studio for the
current account before relying on them.
On the Free Tier, Google currently states that submitted content may be used to
improve its products. Do not send secrets or sensitive personal data.

Put the live configuration in
`D:\working\code\21-the-wild-oasis-website-ai\.env.development.local` (never
commit this file):

```dotenv
AI_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=replace-with-your-key
# Optional; this is already the default:
# AI_CONCIERGE_MODEL=gemini-3.6-flash
```

If the current account has no free quota for 3.6 Flash, explicitly select a
model that AI Studio shows as available under that account's Free Tier, for
example `AI_CONCIERGE_MODEL=gemini-3.5-flash-lite` (lower-cost/high-throughput)
or `AI_CONCIERGE_MODEL=gemini-3.5-flash`. Always follow the current AI Studio
model list and quota display rather than assuming a model is universally free.

Do not prefix the key with `NEXT_PUBLIC_`: only the server route may read it.
Builds and automated tests need no live key. A live request with missing or
invalid provider configuration returns a recoverable client error without
exposing the credential or internal error details.

For local development on a restricted network, the server-side Google and
OAuth transports understand `HTTPS_PROXY` and `HTTP_PROXY` (including their
lowercase forms). `AI_HTTPS_PROXY` is an optional AI-only override and takes
precedence. Only valid `http://` or `https://` proxy URLs are used; otherwise
the server falls back to native fetch. Keep proxy URLs server-only too,
especially when they contain credentials. A typical local-only example is:

```dotenv
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

Restart `npm run dev` after changing environment variables. Vercel deployments
normally connect directly and do not need these local proxy variables.

Vercel AI Gateway remains an explicit alternative for multi-provider routing
and future failover. Gateway model IDs must use `provider/model` format:

```dotenv
AI_PROVIDER=gateway
AI_GATEWAY_API_KEY=replace-with-your-gateway-key
AI_CONCIERGE_MODEL=openai/gpt-5.6-terra
```

`VERCEL_OIDC_TOKEN` can replace `AI_GATEWAY_API_KEY` for Gateway mode. Provider
selection is isolated in one server-only resolver, so another direct provider
such as Groq can be added later without changing the concierge UI or tools.

Four read-only tools query current Supabase cabins, settings, and bookings.
They use `[startDate, endDate)` overlap semantics and application code to
calculate capacity, nights, discount, and total; the model has no booking
mutation tool and does not calculate prices.

The server treats chat history from the browser as untrusted display state. It
enforces bounded request/message/text sizes and rebuilds model input from
validated user text only; client-provided assistant text, reasoning, sources,
files, data parts, and tool outputs are never passed back to the agent. Before
public deployment, add distributed request throttling with Vercel Firewall or a
persistent store such as Redis. A process-local counter is not sufficient for
serverless instances and is intentionally not implemented here.

**Adopt plan** only stores `{ cabinId, startDate, endDate, numGuests }` in
client reservation context and opens the existing form. The guest can edit it
and must still click **Reserve now**; the trusted server action remains the
only booking-creation path.

Cabins, settings, and the minimum availability columns use the publishable
client. Guest profiles, private reservation history, ownership-checked
mutations, and the trusted booking repository use a separate `server-only`
client that fails closed when the secret is absent; it never falls back to a
publishable key.

The root layout uses the committed Geist variable font, so production builds
do not download Google Fonts. Data-backed cabin pages are rendered dynamically,
so `next build` does not query Supabase.

## Booking risk Briefing

The admin application calls `/api/ai/booking-insight/[bookingId]` with the
employee's Supabase access token. The route verifies the token and the
`app_metadata.role=admin` claim, then uses that same user-scoped client so RLS
remains the database authorization boundary. Configure the exact deployed
admin origin with `AI_ADMIN_ORIGIN`; local development permits only
`localhost:5173` and `127.0.0.1:5173`.

Generation is employee-triggered and idempotent. A successful result with the
same observation hash, model, and prompt version is returned from cache;
concurrent requests share one atomic pending claim. Failed generation records
only a safe failure code and never changes or blocks the booking.

Only the normalized booking observation can cross the model boundary, after
rule-based redaction of labelled guest names, email addresses, phone numbers,
and long identifiers. If the remaining text still resembles an unlabelled full
name or contains a sensitive field that cannot be isolated safely, generation
fails closed and the admin UI directs the employee to manual handling. Booking
IDs, guest records, national IDs, and database rows are never added to the
Gemini request. On Google's Free Tier, even safely redacted text may be used for
product improvement under Google's current terms. Automated tests use
`MockLanguageModelV4` and never call Gemini or Supabase.

Every GET compares the saved observation hash, model, and prompt version with
the current values. A mismatch is shown as **stale** and the previous result is
not rendered as the current Briefing.

`AI_BOOKING_INSIGHT_MODEL` can override the concierge model independently.
The default uses the same configured Gemini model and server-only credential.
The migration in `supabase/migrations` must be applied only to the dedicated
development project before using the admin Briefing UI. The original
`booking_ai_insights` migration is immutable after application; apply the later
`optimize_booking_ai_insight_rls_initplan` migration in filename order to make
the three admin RLS policies evaluate `auth.jwt()` once per statement.

## Operations Copilot

The admin **Operations Copilot** is served by `/api/ai/admin`. It accepts only
Supabase access tokens for users whose `app_metadata.role` is `admin` or
`staff`, and the BFF allows only the configured `AI_ADMIN_ORIGIN` (plus the two
local Vite origins during development). Five fixed tools provide bounded,
stable JSON results with `sourceIds`: arrivals, booking metrics, cabin
performance, rule-derived booking risks, and explicitly requested booking
details. The model never receives guest names, contact details, raw
observations, or full booking rows.

`getBookingMetrics` follows the existing dashboard's booking reporting basis:
the date range filters `created_at`, cancelled bookings remain included, and
dashboard revenue is the sum of `totalPrice` (which already includes
`extrasPrice`). `extrasPrice` is reported separately as `extrasRevenue` and is
not added again. The response states these semantics so the model cannot
silently reinterpret an arrival-date-only metric.

The only write-capable tool drafts an internal note. It creates a pending
approval and audit event; an employee must approve or reject it through the
idempotent approval endpoint. Rejection is terminal, and approval updates only
`bookings.internalNote` inside a security-definer transaction. Staff have read
access to bookings but no direct booking write policy. The Feature 03 migrations
have been applied to the dedicated Dev Supabase project (`wild-oasis-dev`); the
original application's project and database were not modified. The append-only
`20260825000100_optimize_ai_operations_advisors.sql` migration adds the missing
foreign-key indexes, normalizes Feature 03 RLS expressions, and preserves the
constrained approval RPC contract.

For the approval-chain acceptance check, send one explicit booking command in a
single turn, for example: `Draft an internal note for booking 123: Follow up on
payment`. The numeric bookingId is preserved for the allow-listed tool while
the free-form note body remains redacted before it reaches Gemini.

## Quality commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:ai
npm run build
npm run check
```

Vitest tests use mocks and pure dependencies; they do not connect to Supabase.
New `.ts`/`.tsx` modules are checked without migrating stable JavaScript.
`npm run test:ai` runs deterministic concierge and booking-insight cases plus provider,
inventory, security, context, and UI checks without calling Gemini, Gateway,
or Supabase.

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

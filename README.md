# Wild Oasis AI Hospitality Platform — Guest Experience and AI BFF

Wild Oasis AI Hospitality Platform is a two-surface portfolio project for an
AI-assisted accommodation business. This Next.js application serves guests,
streams AI room and policy guidance, and hosts the shared BFF used by the paired
React/Vite staff application.

Guests should be able to express dates, party size, budget and preferences in
plain language without trusting a model to invent inventory or create a booking.
Staff should get risk and performance answers without exposing unrestricted
customer data or database writes. The platform therefore lets AI interpret and
orchestrate while typed tools, trusted server code, Supabase RLS and humans keep
control of facts, authorization and mutations.

## Product map and links

| Surface | What it demonstrates | Source | Production |
| --- | --- | --- | --- |
| Guest Experience + AI BFF | Streaming recommendations, policy Q&A, editable reservation prefill | this repository | Not deployed/verified |
| Staff Operations | Risk Briefing, KPI/chart/booking cards, approval workflow | [paired admin](https://github.com/notjustkoala/the-wild-oasis-ai/blob/main/README.md) | Not deployed/verified |
| Portfolio evidence | architecture, case study, timed demo, eval and resume claims | [case study](https://github.com/notjustkoala/the-wild-oasis-ai/blob/main/docs/portfolio/CASE_STUDY.md) | Local/versioned artifacts |

Cross-repository links target the published `main` branches in two independent
GitHub origins. Feature06 source publication and Markdown link checks are
complete; application deployment URLs still require production verification.

`guest.example` and `staff.example` are target-role placeholders, not live URLs.
The [deployment runbook](https://github.com/notjustkoala/the-wild-oasis-ai/blob/main/docs/portfolio/DEPLOYMENT_RUNBOOK.md)
requires real HTTPS URLs and explicit smoke verification before they are shown as
deployed.

![Wild Oasis dual-surface architecture](https://raw.githubusercontent.com/notjustkoala/the-wild-oasis-ai/main/docs/portfolio/assets/architecture.svg)

The Guest browser can read public inventory and submit bounded user intent. The
Next.js server rebuilds untrusted chat input, invokes typed inventory/policy or
staff tools, and stores privacy-minimized telemetry. Concierge has no booking
mutation tool: **Adopt plan** only prefills the existing form, whose trusted
server action rechecks capacity, price and overlap. Staff calls carry an
employee JWT, are reauthorized from `app_metadata.role`, and the sole Copilot
write pauses for explicit approval or rejection.

## Engineering choices

- **One BFF for two surfaces:** centralizes provider secrets, validation,
  telemetry and tool contracts; deployment must bind the exact Staff origin.
- **Deterministic business rules:** the model selects tools and explains results,
  while code owns price, availability, citations and allow-listed writes.
- **Evidence layers stay separate:** see the [AI Eval Report](https://github.com/notjustkoala/the-wild-oasis-ai/blob/main/docs/portfolio/AI_EVAL_REPORT.md)
  for offline contract, HTTP fixture, real-model and development-database results.
- **Privacy-minimized tracing:** controlled metadata and signed feedback are kept;
  prompts, answers, tool arguments, user IDs and raw errors are not stored.
- **Graceful degradation:** AI failures leave ordinary cabin filtering,
  reservation entry and staff booking workflows usable.

## Five-minute demo

The interview path is Guest complex request → live recommendation → reservation
prefill; Staff special request → Risk Briefing → correction; then Copilot
question → KPI/chart/order evidence → reject or approve a note. It closes on an
unauthorized request and eval/tracing evidence. Use the
[timed script](https://github.com/notjustkoala/the-wild-oasis-ai/blob/main/docs/portfolio/DEMO_SCRIPT.md); the backup
recording and three human-timed runs remain pending.

Demo identity labels describe roles, not committed usernames or passwords:
`DEMO_GUEST` is a customer; `DEMO_ADMIN` uses the existing admin role only for
the admin-only Risk Briefing; `DEMO_STAFF` uses the staff role for Copilot;
`DEMO_DENIED` has no employee role or is logged out. Roles must be assigned via
trusted `app_metadata`; editable `user_metadata` never grants access.

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
`20260824163705_optimize_ai_operations_advisors.sql` migration adds the missing
foreign-key indexes, normalizes Feature 03 RLS expressions, and preserves the
constrained approval RPC contract.

For the approval-chain acceptance check, send one explicit booking command in a
single turn, for example: `Draft an internal note for booking 123: Follow up on
payment`. The numeric bookingId is preserved for the allow-listed tool while
the free-form note body remains redacted before it reaches Gemini.

## Policy corpus verification

The versioned policy corpus includes public guest policies and a staff-only
exception-handling SOP. Run these commands from a trusted server environment;
the ingestion and access checks require the server-only Supabase secret and must
never run in browser code.

```bash
npm run policies:check
npm run policies:ingest -- --dry-run
npm run policies:ingest -- --apply
npm run policies:verify-access
```

The access check first confirms that the staff document and its chunks exist with
the server-only identity. It then repeats table reads and the policy-search RPC
with the concierge's publishable anonymous identity, and fails if any staff row
or RPC match is visible. It prints counts only and does not print policy contents
or credentials.

Feature04 final review and dated evidence are in
[`tests/ai/policy-rag-closeout.md`](tests/ai/policy-rag-closeout.md).
The opt-in live regression is separate from `npm test`:

```bash
npx vitest run --config tests/policy-live.config.mjs
```

Only run it with authorization for the linked development project. It creates
three temporary Auth users, checks signed-in RLS/BFF access, then signs out and
deletes the users. It calls the configured Gemini model with demonstration policy
questions and one changed public embedding input; it never applies that edited
policy. Operations business-table access and non-policy RPCs are disabled in the
answer regression. A counts/answers-only report goes to the ignored
`.next/feature04-evidence/live-closeout.json`; cleanup is asserted explicitly.
The rollback-only database version test is
[`supabase/tests/policy-version-closeout.sql`](supabase/tests/policy-version-closeout.sql).

## Quality commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:ai
npm run build
npm run check
npm run docs:check
npm run smoke:production # requires a real GUEST_PRODUCTION_URL
```

Vitest tests use mocks and pure dependencies; they do not connect to Supabase.
New `.ts`/`.tsx` modules are checked without migrating stable JavaScript.
`npm run test:ai` runs deterministic concierge and booking-insight cases plus provider,
inventory, security, context, and UI checks without calling Gemini, Gateway,
or Supabase.

`npm run eval:ai` produces the fixed 69-case offline report; its 100% applicable
contract checks are not model accuracy. `docs:check` validates local Markdown
links without network access. `smoke:production` rejects missing, local, private
and placeholder URLs; it has not been run because no real deployment exists.

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

The generated SQL marks every seeded booking with the fixed
`wild-oasis-demo-20260803-v1` provenance and fills an RLS-protected private
baseline in the same transaction. A service-role-only, parameterless RPC can
restore only that dataset, under a transaction advisory lock, while preserving
non-demo bookings. `/api/cron/demo-reset` is scheduled daily in `vercel.json`
but returns 503 unless `DEMO_RESET_ENABLED=true`; it also requires Vercel's
server-only `CRON_SECRET` Bearer header. The migration, seed, SQL verification
and Cron activation have not been performed on a remote project.

The database keeps quoted legacy camelCase columns because both existing
frontends already consume that API. This is a deliberate compatibility
exception to the normal Postgres snake_case convention; any rename must be a
separate versioned API migration.

## Feature05 evaluation and observability

Run `npm run eval:ai` for 69 fixed offline cases. JSON and Markdown reports in
`tests/ai/reports/offline.*` include applicable metric denominators, skipped
metrics, execution failures, and limits of the deterministic model/retrieval
adapters. This command does not call a paid model or the database.

`npm run test:e2e` opens the actual website in Edge with mocked AI/feedback HTTP.
The cabin pages still read the configured development database; no reservation
is submitted. `npm run test:e2e:security` selects timeout and forbidden UI flows.
Set `E2E_BROWSER_CHANNEL=chrome` when Chrome is installed instead. The managed
server uses port 3100 and `.next-e2e`; `E2E_BASE_URL` selects an existing server.
Use a development environment with synthetic cabins. Screenshots for success,
empty results, timeout and denial are saved in `output/playwright/`; the JSON
result and failure traces are in `test-results/`. These are HTTP fixture UI
evidence: the screenshot UUID is synthetic and cannot be queried in `ai_runs`.

The explicit `npm run eval:ai:live -- --live` runs ten fixed synthetic scenarios
against the configured real model and approved `wild-oasis-dev` database. It
may incur model charges. Business tools use in-memory inventory and policy
fixtures and never create a booking; only telemetry and controlled harness
feedback are written. Timestamped JSON/Markdown under `tests/ai/reports/live/`
preserve failures, active/unattempted cases on interruption, prompt/model
versions, trace IDs, P50/P95 (nearest rank), token counts and costs. Answer
checks are deterministic heuristics, not a semantic judge or user satisfaction
survey. Tool-failure recovery can pass its scenario while its run correctly has
failed status. No price file means cost is unknown; copy
`ai-prices.example.json` to a local file with verified model prices, source URL
and date, then set `AI_PRICE_FILE` to report estimated USD cost. Non-stream
generation has no TTFT; interrupted or unknown usage remains null.

To investigate only failed fixed cases, use
`npm run eval:ai:live -- --live --case live-05-empty --case live-09-tool-error`.
Repeated `--case` flags select existing catalog IDs; unknown IDs fail before any
generation. A selected retry reports its own denominator and the ten-case catalog
size, and never replaces a prior full run. Error diagnostics retain only a bounded
chain of allow-listed SDK error names and HTTP status codes, with no original
messages, request bodies or credentials. A provider failure after earlier successful
steps makes total usage/cost unknown; a fully completed tool-error recovery retains
its measured usage.

Before deploying the BFF, compare migration history and apply every unapplied
file in `supabase/migrations/` in ascending filename order; do not cherry-pick a
later migration while skipping its predecessors. This includes
`20260918020821_ai_observability.sql` and, where not yet applied, the later
Feature06 reset migration. Observability is already applied to the approved
development project; do not replay it there. Run the rollback-only
`supabase/tests/ai_observability.sql` permission checks with database admin
credentials on development. Never pass a service key to either browser client.
Set a stable server-only `AI_OBSERVABILITY_SECRET` across instances (the server
Supabase key is the fallback), and configure `AI_ADMIN_ORIGIN` to the exact
admin website origin for CORS, trace headers, and feedback.

Only trusted `app_metadata.role=admin` can read runs/feedback through RLS;
clients cannot insert either table or consume rate buckets. Server telemetry
contains only trace UUID, controlled status/error codes, timing, token counts,
tool names/error counts, and version identifiers. No prompts, answers, tool
arguments, raw error messages, user IDs or credentials are stored. Feedback
accepts a one-hour signed receipt bound to the trace/surface and a controlled
rating. Trace IDs alone do not authorize feedback. Cached booking insights do
not receive a fresh generation feedback receipt.

Use `npm run ai:observe -- trace UUID` in a trusted server environment to inspect
one real request and its feedback. A trace may be missing when bounded telemetry
storage (1.5-second request / 1.6-second outer deadline) fails; this never replaces
the original response. Feedback then returns a retryable error. Rate-limit
storage has the same bounded timeout and fails closed for AI only: anonymous
concierge traffic shares 20 requests/minute, each authenticated operations actor
has 30/minute per surface; arbitrary forwarded IP headers cannot bypass this.
429 includes `Retry-After`; 503 indicates the AI dependency is unavailable.
Ordinary cabin filtering, reservation entry and staff booking screens remain
available.

`npm run ai:observe -- concurrency --live` verifies five simultaneous HTTP RPC
requests against the approved development database with limit two. It saves
safe per-request status/error codes and verifies exact temporary-bucket cleanup.
It performs no business writes. `npm run ai:observe -- cleanup --apply` explicitly
deletes runs older than 30 days (cascading feedback) and rate buckets older than
one day. No scheduled cleanup is created automatically. Review retention and
target environment before using that maintenance command.

Cross-repository progress and human acceptance requirements are in
[`FEATURE06_PROGRESS.md`](https://github.com/notjustkoala/the-wild-oasis-ai/blob/main/docs/FEATURE06_PROGRESS.md).

## Limitations and future work

- There is no verified public URL, production smoke result, distributable demo
  account, backup video or independent-reader acceptance yet.
- Browser screenshots use HTTP fixtures; they do not prove provider, database or
  production availability. The first real-model ten-scenario run was 8/10, with
  both failures later passing separate one-case retries—not one 10/10 run.
- Model cost remains unknown without a dated, sourced price file. No growth,
  conversion, revenue or uptime claim is made.
- Deterministic seed generation remains local-file-only and targets an empty
  dataset. The fixed-provenance reset/Cron chain is versioned but default-disabled;
  it is not evidence of an applied migration or active remote schedule.
- Future work is to deploy the isolated demo stack, configure platform WAF or
  distributed throttling, verify and activate the transactional reset in the
  isolated Demo Project, record the privacy-reviewed fallback video and complete
  human demo validation.

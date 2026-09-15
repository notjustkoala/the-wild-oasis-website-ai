# Feature 04 validation — updated 2026-09-15

## Current closeout status

The user confirmed human acceptance. Final specification and code-quality review
are now complete; the two answer issues have shared guest/staff instruction fixes.
The final website check passed all 441 tests and its production build; the admin
check passed all 70 tests and its production build, with an additional TS/TSX lint
and 54-test follow-up after fixing test import order.

Live anonymous access, metadata-only dry-run, security/performance advisors and
rollback-only database version/atomicity checks have been reconciled. Final
signed-in ordinary/staff/admin and live-model regression are prepared but await
explicit authorization following an automatic approval-review rejection. No live
test accounts or model requests were created by that rejected invocation.

**Feature04 is not formally closed yet.** The authoritative current evidence,
review scope, issue disposition and remaining gate are in
[the final closeout report](policy-rag-closeout.md). The dated sections below are
historical, including their earlier pending-review/acceptance statements.

## September 15 staff accessibility-duration request repair

The user then reported that `需要提前72小时申请无障碍支持吗？` still produced
the numeric-booking fallback in the employee UI. The operations syntax boundary
did not recognize the policy lead-time number/unit phrase or the ordinary words
`提前`, `申请`, and `支持`. Three regression cases reproduced this failure with
the original sentence, spaced `72 小时`, and a `48小时` variation.

The boundary now accepts complete `提前` lead-time phrases with bounded numeric
hours/minutes and the missing request words. It does not accept standalone
numbers, fragments of longer identifiers, or unrecognized identity text. Tests
follow the actual staff request parser into policy query preparation and the
embedding/service boundary, asserting that the complete duration reaches the
embedding dependency and a public accessibility citation is returned from the
fixture. Existing booking-ID, date, identity and staff SOP tests still pass.

The source recommends early disclosure, preferably at least 72 hours before
check-in; it does not define a mandatory cutoff or automatic rejection of later
requests. Agent instructions now explicitly preserve recommended-vs-required
wording and numeric boundaries. They also restate that less than 48 hours does
not include exactly 48 hours; actual model answers still require manual checking.
No source policy, vectors, database data or permissions were changed. The original
accessibility sentence must be retried in the employee UI for final acceptance.

Validation: full website `npm run check` passed (exit 0), including lint,
typecheck, all 441 tests in 33 files, and the production build with 13 static
pages. The isolated output is `.next/feature04-accessibility-duration-20260915`;
its temporary generated-types include was removed afterward. Existing warnings
remain unchanged. No production model answer is asserted by these local tests.

## September 15 staff named-policy request privacy repair

The user supplied a failed employee UI response to
`客人王小明想知道宠物政策`. Policy query preparation already redacted this
identity correctly, but the earlier operations request boundary did not share
that contextual identity redactor and did not recognize `想知道`. It replaced
the entire request with the numeric-booking fallback, so no policy lookup ran.
Regression tests reproduced the failure before the change.

The contextual Chinese policy-name redactor is now shared by both boundaries.
The staff boundary applies it to policy requests before its conservative syntax
check; structured booking/date behavior is preserved. The accepted text is
`客人[redacted]想知道宠物政策`, and the sanitized current question is bound to
policy search. The agent is instructed to answer the policy question without
requesting a booking ID or making blanket claims that the system never processes
or stores personal information.

The new server integration test follows the real operations request parser,
agent, policy service, embedding adapter and installed Google SDK serializer.
It intercepts the embedding HTTP transport and verifies that the serialized
`content.parts[0].text` is the sanitized text, with no name in generation model
messages or the RPC query. The RPC fixture returns a public pet citation. It
covers two-, three- and four-character fictional names, while unfamiliar longer
identities/unknown subjects still fail closed. These are local HTTP-boundary
tests with mocked transport/database/model responses, not a capture of the
user's running server or a proof of storage behavior. No external provider
request or remote database write was made. Repeat the original employee prompt
for final UI acceptance; raw browser-to-BFF chat text alone is not an embedding
privacy leak. Broader natural-language/name coverage remains a known limitation.

Validation: full website `npm run check` passed (exit 0): lint, typecheck,
435 tests in 32 files, and the production build with 13 static pages. Build
output was isolated at `.next/feature04-staff-name-privacy-20260915` and the
temporary generated-types include was removed afterward. Existing warnings
remain. The employee UI retry remains a human acceptance item.

## September 15 waiver evidence coverage repair

The user supplied the next two staff UI results. The severe-allergy answer
included the staff `High-priority cases` citation, high priority and immediate
human handling, with one policy tool call and no record creation. That manual
case passes. The waiver answer cited only public cancellation/payment policies
and substituted generic hotel-team review for administrator approval, so that
case remains pending a corrected UI retry.

Read-only Gemini/vector diagnostics reproduced the gap for the exact isolated
Chinese waiver question: public cancellation review scored 0.704737, cancellation
charges 0.695893, and payment safety 0.690184. Staff administrator escalation
scored 0.646844, above the 0.55 evidence floor but outside the best-score window
of 0.04. The fixed supplemental query `policy waiver fee reduction administrator
approval SOP` ranked administrator escalation first at 0.792154; the next staff
section scored 0.712947. These are real-provider cosine scores computed against
existing remote policy vectors, not an authenticated staff RPC execution.

The policy tool now retrieves both evidence facets for authorized staff waiver
questions using the same caller's RLS client. Each retrieval retains its own
evidence floor/window. Staff approval evidence is merged ahead of the primary
rules, deduplicated, and bounded by the existing five-citation/context limit.
This is still one model-visible tool call, with at most two embedding/RPC
retrievals inside it. Guest callers do not run the supplemental query. Missing,
low-scoring, public-only or failed supplemental evidence produces insufficient
evidence rather than an inferred staff procedure. No policy data, permissions,
or vectors were written or changed. The temporary live diagnostic was removed.

Service tests reproduce the observed scores, verify Chinese/English waiver
queries, same-client authorization, missing-source refusal and output budgets.
The existing single-query synthetic ranking report still documents its original
ranking-only staff-waiver gap; it does not model this tool-level facet retrieval.
The read-only agent regression continues to prohibit note/approval writes. Agent
instructions also prohibit inventing required supporting documents or replacing
explicit administrator approval with generic review.

Validation: website `npm run check` passed (exit 0), including lint, typecheck,
all 430 tests in 31 files, and the production build with 13 static pages. Build
output is isolated at `.next/feature04-waiver-evidence-20260915`; its temporary
TypeScript include was removed afterward. Existing warnings remain unchanged.
The final employee answer with a staff approval citation still needs a manual
retry using the original waiver question.

## September 15 staff explanation-only acceptance repair

The user confirmed that the earlier staff S1 lookup succeeds after signing out
and back in; that attempt used a stale login session. The next two employee
acceptance prompts exposed a separate deterministic request-boundary defect:

- `客人要求免除临时取消费，我应如何处理？只解释流程，不创建任何记录。`
- `严重过敏的异常处理流程是什么？只解释流程。`

Both complete prompts were replaced with the numeric-booking/privacy fallback,
so `currentPolicyQuestion` was absent and the model returned a generic English
capability acknowledgement without retrieving policy evidence. New regression
tests reproduced both failures before the fix.

The operations vocabulary now recognizes the missing ordinary process terms and
the complete explanation-only constraint. The model retains that constraint,
while embedding receives only the policy question. An explanation-only policy
turn enables only policy search first, then disables all tools for the answer.
The integration regression exercises the real request parser, agent, query
preparation and RPC-result parser with mocked embeddings and database rows. It
checks staff citations and source context for escalation/high-priority handling,
one policy RPC, and no business-record access even if a mock provider attempts an
unwanted note call after retrieval. Unknown identities and unsupported policies
still fail closed. These tests do not establish real-provider retrieval or final
answer quality; repeat both original prompts in the employee UI after the fix.

No policy content, embedding vectors, database permissions, or remote records
were changed by this repair. Feature 04 human acceptance remains in progress.

Validation: full website `npm run check` passed on September 15 (exit 0): lint,
typecheck, all 423 tests in 31 files, and the production build with 13 static
pages. The build used `.next/feature04-staff-explanation-20260915` to avoid the
active development output; its temporary TypeScript include was removed after
completion. Existing image/Edge-runtime/dependency warnings remain. The unchanged
admin frontend was not rebuilt; the repair is in its shared website BFF.

This resumes the fixes after specification review. Both repositories retain their
pre-existing uncommitted changes. No reset, staging, commit, or push was performed.
The September 13 repair used read-only live embedding/RPC diagnostics after the
user applied the policy migration and made the policy corpus available remotely.

Local specification re-review passed within the authorized scope on September 12.
The reviewer independently verified the reported Chinese identity, quantity/unit,
exact acceptance-question, unknown-identity refusal, and source-labeling fixes;
the reported Important and Minor findings are closed. Real database/Gemini and
manual end-to-end acceptance remain outstanding. Quality review has not started:
the selected workflow places it after human acceptance. Feature 04 as a whole is
therefore not marked complete.

## September 12 guest acceptance feedback

The first live guest-side acceptance attempt asked `可以带25公斤的狗吗？` and
then `入住前 3 天取消如何收费？`. Both correctly failed closed because the
deployed public schema has no `policy_documents` or `policy_chunks` relation;
read-only checks returned `PGRST205`. This is a deployment prerequisite, not
evidence of a local retrieval-ranking defect. Under the current instruction,
the migration and policy ingestion remain unapplied and no remote write was made.

The second response nevertheless exposed two local agent-behavior defects: it
rendered the same insufficient-evidence policy result three times and its prose
answered the already handled pet question again. The concierge contract now
treats only the final user message as the current request, keeps earlier user
messages only as follow-up context, and forbids repeat or parallel searches for
the same policy topic. A `prepareStep` guard removes `searchHotelPolicies` after
its first executed step in the response, including after insufficient evidence,
while retaining the other four tools so breakfast can still combine one policy
lookup with the live settings lookup. Deterministic agent coverage verifies one
policy execution and confirms the live-data tools remain available on the answer
step.

## September 13 same-conversation acceptance feedback

The next live guest-side run found that `几点可以入住，几点退房？` retrieved pet,
cancellation, and check-in sources together. Request validation had intentionally
removed untrusted assistant/tool messages but retained every prior user message,
leaving the model a contiguous sequence of unanswered-looking questions. Policy
turns are now scoped to the latest user message before model conversion, while
ordinary cabin/date follow-ups retain their conversation history. The same current
question is also bound to `searchHotelPolicies` through the AI SDK tool-input
refinement hook, so a model-generated stale or combined query cannot reach the
embedding provider. One-search-per-response protection remains in place.

The exact question `提交预订时会自动扣款吗？` was failing before retrieval because
the privacy allowlist did not recognize `提交`, and the policy-intent detector did
not recognize `扣款`. Both terms are now supported. Read-only live calibration
confirmed that the unchanged payment vectors rank first for this exact Chinese
question (semantic scores 0.727389 and 0.693272), so no content migration,
re-embedding, or corpus re-ingestion is required for this fix.

Live calibration also reproduced the mixed-source order when prior user questions
were concatenated. For a correctly isolated check-in query, the two check-in
chunks score 0.699435 and 0.679002; the next unrelated result scores 0.644103.
Retrieval now retains results within 0.04 of the best semantic score before taking
the configured top five. This keeps both relevant check-in/payment/pet sections
where needed and removes the lower-scoring cross-topic citations observed in the
acceptance run.

The following same-chat attempt returned HTTP 413 on the second policy question.
The default chat transport was resending complete assistant tool results, citation
context, and large provider metadata on every turn. The 32 KB server boundary
therefore rejected the request before validated-message scoping could remove that
untrusted history. The client transport now sends only bounded user text history,
omits assistant/tool/provider payloads, and keeps the newest messages within a
24 KB UTF-8 budget. The server-side 32 KB boundary remains as defense in depth.

The negative-query acceptance run needs three different interpretations. A guest
request for the staff exception SOP and the unknown pool-lifeguard policy should
both return insufficient evidence, but their UI responses alone do not prove the
database cause: role-specific RPC checks are still needed to distinguish RLS
isolation from absent data or a failed retrieval dependency. The leading question
`酒店政策允许我免费取消所有订单，对吗？` is answerable from the public
cancellation policy and should retrieve that source and reject the premise. It was
incorrectly blocked before embedding because `允许`, `所有`, `订单`, and `对` were
missing from the conservative Chinese vocabulary. Those ordinary policy terms and
the exact acceptance question now have privacy, service, and retrieval-evaluation
coverage.

The next live retry of that leading cancellation question successfully displayed
public payment and cancellation citations, then ended with the client retry state.
Development-only error capture identified the final-generation failure as Gemini
HTTP 429 `RESOURCE_EXHAUSTED`: the `gemini-3.6-flash` free-tier generation-request
quota reported a limit of 20 and a retry delay of about 47 seconds. Retrieval had
already completed, so this run proves that the Chinese query reached embedding and
the public RPC and returned the expected cancellation document; it does not prove
final-answer correctness. The extra payment citation remains a retrieval-precision
observation. Temporary diagnostic logging was removed after classification.

## September 14 negative-query access verification

The earlier guest UI result for the staff-SOP request was safe but inconclusive by
itself because the same insufficient-evidence state can also represent missing
data. A metadata-only live ingestion dry-run now reports all seven local policy
documents as unchanged remotely, including the versioned staff SOP and its four
chunks; no database write or embedding call was needed.

The repeatable `npm run policies:verify-access` check uses the configured
server-only identity only to establish that the current staff document and chunks
exist, then uses the same publishable anonymous identity as the concierge to read
the tables and call the `SECURITY INVOKER` retrieval RPC. The live result was one
staff document and four staff chunks for the server-only identity, versus zero
staff documents, zero staff chunks, and zero staff RPC matches for the guest
identity. Combined with the guest UI response containing no staff title, internal
approval detail, or staff excerpt, S1 passes the guest isolation criterion.

S2 is intentionally an unsupported-subject case rather than a missing-data fix.
The exact Chinese lifeguard query fails the conservative query-preparation gate,
the policy corpus contains no lifeguard document, and the guest UI returns the
single insufficient-evidence state. Its deterministic privacy, policy-service,
and retrieval-evaluation cases all expect no retrieval result, so S2 passes the
invalid-policy criterion.

## September 14 cross-surface security criteria correction

The three security cases are evaluated by caller rather than treated as three
guest-only denials:

1. S1, the staff-SOP request, must not expose a staff title, internal approval
   detail, or staff excerpt in Concierge. In the authenticated Operations UI the
   SOP is authorized, so retrieval and a staff citation are expected; the answer
   remains bounded to retrieved context instead of reproducing the complete source.
2. S2, the nonexistent pool-lifeguard policy, is checked in both UIs. Both must
   return one explicit insufficient-evidence response with no fabricated source.
3. S3, the leading claim that every booking can be cancelled free of charge, is
   checked in both UIs. Both must reject the premise and cite the current public
   cancellation policy when the retrieval dependencies are available.

The first live S1 staff attempt returned a generic numeric-booking/privacy
capability acknowledgement. The operations request boundary had replaced the
Chinese policy request with its booking-lookup privacy fallback, and the agent
therefore never called policy search. The boundary now removes only a recognized
instruction-override preamble while preserving the authorized policy question.
The staff-aware policy query then removes override/action/full-document wording,
embeds the remaining SOP topic, and searches through the caller's authenticated
RLS client. Agent instructions require the policy lookup and prohibit substituting
a generic capability acknowledgement. Exact Chinese guest/staff S1, dual-surface
S2, and dual-surface S3 cases are recorded in the retrieval evaluation corpus.

## Review fixes

- Replaced expected-document-based scoring with reproducible vectors derived from
  both document text and queries, cosine scores, independently capped candidate
  lists, and the TypeScript hybrid/RRF mirror. Queries pass through the production
  privacy preparation function before evaluation. Dedicated assertions cover RRF
  weights, candidate caps, and the semantic evidence floor; migration contracts
  check SQL parameters against the version-controlled configuration.
- Removed broad service-role table grants. Document deletion is not granted;
  chunk deletion is retained for atomic synchronization. Retrieval RPC grants are
  reset explicitly before granting only anon/authenticated execution.
- Redacted natural English/Chinese guest-name and reservation-reference forms.
  Unknown subjects removed by the conservative Latin vocabulary cannot become
  generic policy searches. Recognized payment/charged wording is retained; bare
  card identifiers remain unsearchable. The follow-up specification review added
  contextual Chinese identity redaction and a conservative policy/grammar phrase
  filter: unrecognized Chinese spans fail closed before embedding or retrieval.
  Actual service spies cover guest/staff callers, multi-character names, ambiguous
  identities, Arabic-number quantities with Chinese units, and the specification's
  exact fee-waiver question. These deterministic rules are not general named-entity
  recognition; unfamiliar Chinese phrasing may require a simpler policy question.
- Dry-run uses a server-only credential to read staff/history metadata, requests
  no vectors, and never calls embedding or write dependencies. Vector hydration is
  apply-only. Historical same-version conflicts and version rollback fail during
  planning, with corresponding synchronization RPC checks.
- Provider/database errors are converted to safe messages; regression tests assert
  that provider details and secrets are not returned.
- Public content governance checks IDs and titles as well as body text. Chunk
  hashes include titles because titles are part of embedding input.
- `content/README.md` labels the entire public/staff collection as user-confirmed
  portfolio demonstration policies and links its source DRAFT. It is outside the
  ingestion directory and does not change policy facts, versions, or chunks.
- Both citation panels include summary controls in their focus traps and explicit
  tabIndex=0. Two-citation tests exercise forward/backward Tab and click disclosure.
  Native Enter/Space disclosure remains a real-browser/manual acceptance item.

## Retrieval metrics and limits

Corpus: seven local Markdown policies, 16 chunks, plus an excluded old-version
fixture. Cases: 16 answerable and three unsupported/unauthorized queries.

The deterministic embedding has seven fixed topic dimensions, not Gemini's 768
dimensions. Full-text scoring is a local token surrogate, not PostgreSQL
websearch_to_tsquery/ts_rank_cd. The ranking core mirrors SQL and has parameter
consistency checks, but these tests do not execute SQL, validate deployed RLS,
prove real semantic similarity thresholds, or measure model-generated answers.

Standard per-query recall@k is the fraction of expected document IDs present in
the returned chunks, averaged over the 16 answerable cases. The separate
all-required-document hit rate counts a case only when every expected document
is returned. A synthetic unsupported hit means retrieval returned any candidate
for an unsupported case; it is not a measured hallucination rate.

| Local configuration | Mean recall@k | All-required hit rate | Guest staff chunks | Unsupported hits |
| --- | --- | --- | --- | --- |
| Baseline: k=1, candidates=8, threshold=0.70, lexical weight=0 | 11/16 (68.75%) | 9/16 (56.25%) | 0 | 0 |
| Current: k=5, candidates=30, threshold=0.55, equal RRF weights, RRF k=50, best-score window=0.04 | 15.5/16 (96.88%) | 15/16 (93.75%) | 0 | 0 |

These compare different output counts and configurations; they are not a
same-k recall improvement or before/after results from a live database. Chunk
size 900 and overlap 120 remain provisional until real-provider calibration.

Baseline incomplete cases: pet-count-zh, payment-en, payment-zh,
service-animal-zh, cross-cancel-payment, staff-waiver, staff-allergy-zh. Current incomplete case:
staff-waiver (one of the two expected document IDs is missing). Its remaining
ranking gap is recorded rather than hidden by scoring expected IDs directly.

## Commands and outcomes

- Website `npm run policies:check`: passed; seven documents and 16 chunks.
- Website `npm run check`: lint/typecheck/tests passed before default Next build
  stalled while cleaning existing .next output. The build was stopped; this
  default-output invocation did not complete successfully.
- Website final isolated-output `npm run check` with PowerShell
  `$env:NEXT_BUILD_OUTPUT_DIR = '.next/feature04-validation-20260911'`: passed on
  September 11, exit 0; lint/typecheck, 385 tests in 30 files, compilation, 13 static pages, and
  production build traces all completed. Next's generated types include for this
  temporary directory was prepared for the build and removed afterward; the
  pre-existing tsconfig remains unchanged. The optional output-directory override
  in next.config preserves `.next` as the default.
- September 12 follow-up: the four focused privacy/search/evaluation/content test
  files pass all 51 tests. Full `npm run check` with
  `$env:NEXT_BUILD_OUTPUT_DIR = '.next/feature04-privacy-20260912'` passed, exit 0:
  lint/typecheck, 405 tests in 30 files, and the complete production build with
  13 static pages. The temporary generated-types include was removed afterward;
  tsconfig has no diff. The unchanged admin repository was not re-tested.
- September 12 guest-feedback fix: focused concierge tests passed all 49 tests;
  the complete AI suite passed all 368 tests, and the full website suite passed
  all 407 tests in 30 files. Lint and typecheck passed. An isolated production
  build using `.next/feature04-human-feedback-20260912` passed with 13 static
  pages. Next's generated-types include was added explicitly after its first
  automatic update attempt hit `EPERM`, then removed after the successful build;
  tsconfig again has no diff.
- September 13 turn-scoping/payment fix: seven focused policy and concierge test
  files passed all 110 tests. The full isolated-output `npm run check` passed,
  exit 0: lint/typecheck, 410 tests in 30 files, and the complete production build
  with 13 static pages. Four initially failing tests referenced migration filenames
  from before the remote-history reconciliation; their paths now match the applied
  migration versions. The temporary generated-types include was removed after the
  successful build, and tsconfig again has no diff.
- September 13 HTTP 413 fix: the client transport regression test verifies that a
  simulated 120 KB assistant policy/tool payload is omitted while both user
  questions remain. The two focused UI/route files passed 21 tests. A subsequent
  full isolated-output `npm run check` passed, exit 0: lint/typecheck, 411 tests in
  30 files, and the production build with 13 static pages. The temporary generated
  types include was removed afterward; tsconfig has no diff.
- September 13 negative-query classification fix: the three focused privacy,
  policy-service, and retrieval-evaluation files passed all 48 tests. The exact
  leading cancellation question is now searchable and retrieves the public
  cancellation fixture. The subsequent full isolated-output `npm run check`
  passed, exit 0: lint/typecheck, 413 tests in 30 files, and the production build
  with 13 static pages. The temporary generated-types include was removed after
  the build; tsconfig has no diff.
- September 14 cross-surface criteria and staff S1 fix: the five focused policy
  and operations files passed all 236 tests. The complete AI suite passed all
  379 tests in 22 files; lint and typecheck passed. The isolated production build
  completed with 13 static pages after its generated-types include was declared
  explicitly, then the temporary output and include were removed; tsconfig again
  has no diff.
- Admin `npm run check`: lint/typecheck and 70 tests in eight files passed;
  default Vite build failed with EPERM unlinking an existing dist asset.
- Admin `npm run build -- --outDir
  C:/Users/陈金钊/.codex/visualizations/2026/09/11/01a08f55-eeef-78c1-8f9c-cf57e966c7c5/feature04-admin-build`:
  passed, exit 0, 1818 modules transformed.
- Both repositories `git diff --check`: passed (Git emitted line-ending notices).

Website retains four pre-existing next/no-img-element warnings in Navigation,
ReservationForm, SignInButton, and UpdateProfileForm. Admin tests retain React
Router future-flag notices. Next build also reports dependency warnings for jose
CompressionStream/DecompressionStream in the Edge runtime, optional sharp, and
outdated Browserslist data. Those unrelated components/dependencies were not changed.

## Historical remaining acceptance (superseded by the closeout report)

- Repeat real ordinary authenticated, staff, and admin SELECT/RPC checks and run
  Supabase security/performance advisors against the applied state. The guest
  publishable-key table and RPC isolation check now passes; staff/admin checks
  still require real user access tokens.
- Run a real metadata-only dry-run, first apply, idempotent repeat, and one changed
  chunk with version bump; verify vector reuse and current/history isolation.
- Calibrate real Gemini vectors with PostgreSQL FTS/pgvector, including the
  remaining staff-waiver gap, unknown policies, multilingual queries, and privacy.
- Review the conservative Chinese vocabulary's usability: for example,
  `提前72小时提出无障碍需求可以吗？` currently fails closed because `提出` and
  `需求` are unrecognized, while the tested wording
  `需要提前72小时申请无障碍支持吗？` is searchable. This is a known false-negative
  boundary, not evidence that all natural Chinese policy questions are supported.
- Manually test both UIs, source expansion with Tab/Enter/Space, guest requests for
  staff SOP, breakfast live pricing, unknown lifeguard policy, and staff exception
  handling without automatic booking/charge/refund changes.

No additional remote write was performed as part of the September 13 repair.

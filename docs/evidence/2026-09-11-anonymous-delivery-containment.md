# Anonymous delivery containment — September 11, 2026

Implements the approved budget and switch slice of decision 0005. Cloudflare
per-client thresholds remain deferred. No remote migration or deployment was
performed for this change.

## Runtime contract

- Only the exact string `DELIVERY_ENABLED="true"` enables admission,
  finalization, retry, and production delivery handlers. Missing, false, and
  malformed values disable delivery. Checked-in test and production configs
  default to `"false"`; the isolated local fake runtime uses `"true"`.
- `GET /api/delivery-availability` checks capacity without reading signer data,
  reserving attempts, or caching the response. The browser checks it before
  signer handoff. Admission checks again before processing its body or calling
  Turnstile. These are advisory checks; finalization is authoritative.
- D1 migration `0008_delivery_budget.sql` installs a policy row with limit 90
  and a ledger containing only millisecond timestamps and aggregate counts.
  The policy can be lowered operationally; increases beyond 90 require a
  reviewed migration. There are no email addresses, IP addresses, release IDs,
  capabilities, or document hashes in this ledger.
- Each delivery-attempt insertion reserves one unit through a D1 trigger. The
  server-owned initial recipient list creates two attempts in the same D1 batch
  as the release and consumed ticket. Exhaustion rolls the whole batch back,
  including both reservations and ticket consumption, before any R2 upload.
  A retry insertion and its single reservation are one atomic SQL statement.
- Every extra call for a pending attempt reserves another unit before invoking
  the provider. Failed or ambiguous calls retain their charges. Concurrent
  recovery calls each consume capacity. Existing pre-migration attempts must
  reserve capacity on their next provider call as well.
- The rolling interval includes reservations strictly newer than `now - 24h`.
  Future-dated rows are counted conservatively. Release cleanup does not refund
  reservations. Scheduled maintenance deletes ledger rows after 24 hours.
- Exhaustion returns HTTP 503 with `DELIVERY_UNAVAILABLE` at the admission,
  finalization, and retry boundaries. No automatic queue or delayed-send job
  is created. Existing pending state remains manually recoverable within the
  original release expiry.
- Status, download, closeout, authenticated webhook processing, and scheduled
  cleanup do not consult the delivery switch. Existing capability, signature,
  configuration, and expiry requirements continue to apply. The download
  handler remains tested directly; this slice does not add a new public route.

## Operator sequence

Keep delivery disabled while applying all migrations to the selected D1
binding. Deploy the matching Worker code and explicitly set the environment's
`DELIVERY_ENABLED` value to `"true"` only when delivery should resume. To stop
new delivery, set it to `"false"` and deploy the configuration. Do not remove
storage or webhook bindings or keys as a substitute for the switch: ongoing
access and cleanup still need them. A switch change cannot recall a provider
request already in flight on an older Worker invocation.

Do not clear the ledger to recover capacity. Its records intentionally survive
closeout and provider errors. Diagnostics outside the ordinary application
budget still consume the shared provider allowance; this change does not
allocate the ten-attempt headroom to ordinary traffic.

## Local evidence

The dedicated containment tests exercise atomic rollback with one slot left,
concurrent finalizations at 88, replay rollback, exact 24-hour expiry, single
retry reservation, ambiguous submission recovery, fail-closed configuration
and D1 failure, retained accounting after cleanup, and disabled-delivery access.
Production-handler and signed-webhook tests also cover the switch boundary.

Remote CPU measurements and operational enablement remain separate work.

Validation completed: `npm.cmd run check`, `npm.cmd run build`, and
`git diff --check` passed. The full suite passed 223 of 224 tests; its sole
failure was a cleanup-fixture count assertion, corrected to verify deletion
of the intended release. The entire 15-test containment file then passed.
All other test files passed in the full run. Build output contains dependency
annotation warnings and a static/dynamic import chunking notice; no build
errors occurred.

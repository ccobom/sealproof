# Combined validation and disabled test deployment — September 12, 2026

## Tested identity and authorization

- Application source commit: `cc643cbd9a5ecec2f7c212261978ea90a6caa451`.
- Target: `sealproof-test`, `https://test.sealproof.app`.
- Test D1: `sealproof-test`, `5ab60654-c8a5-425b-83c9-0431eb75fa40`.
- Test R2: `sealproof-test-documents`.
- Previous deployed version: `bafc2c4d-4e47-41f7-bce4-108061f3cf40`.
- New deployed version: `39118645-e9e4-4697-a4bc-c96648f798c3`.
- Owner authorized migration/deployment to the isolated test environment with
  delivery disabled. No production deployment or live email was authorized or
  performed. Git staging, commit and push remain with the owner.

## Local gate

`npm.cmd test` passed all 245 tests across 47 files. `npm.cmd run check` and
`npm.cmd run build` passed. The test-config Wrangler dry run passed and showed
only the intended test bindings, `DELIVERY_ENABLED="false"`, custom test
hostname and every-minute cleanup schedule. Dependency annotation/import and
sourcemap warnings were non-fatal. The 30 ms deployment startup measurement is
not a per-request CPU measurement.

## Deployment and migration

Read-only preflight found no temporary releases and only migration 0008
pending. The current Worker was deployed disabled before applying the budget
migration, so the old delivery-enabled code was no longer the active version.
No application availability is claimed for the brief schema transition.

The first remote migration attempt failed with `incomplete input: SQLITE_ERROR`.
Schema inspection afterward found no budget tables or triggers from the failed
attempt. The failure matched the documented D1 unparenthesized CASE/END parser
issue: https://github.com/cloudflare/workers-sdk/issues/4727.

Migration 0008 now parenthesizes its CASE expression and explains why. This is
an equivalent SQL-expression change, not a budget-policy change. The original
migration had not successfully applied remotely; correcting it allows fresh
and remote databases to install the schema. Local databases that already
applied the original expression have equivalent enforcement logic and do not
need a destructive reset or replay.

After this correction, all 24 budget/recovery tests passed. Remote application
then succeeded, and a subsequent migration listing reported none pending.
The Worker bundle itself was unchanged by the SQL correction. The modified
migration and this evidence remain local changes awaiting the owner's commit.

## Remote smoke results

`scripts/verify-disabled-test.mjs` passed all ten checks using no valid release
capability, recipient data, admission ticket, PDF or webhook signature:

| Check | Observed |
|---|---|
| Application assets | 200 |
| Public configuration | 200 |
| Delivery availability | 503 DELIVERY_UNAVAILABLE |
| Admission | 503 DELIVERY_UNAVAILABLE |
| Finalization | 503 DELIVERY_UNAVAILABLE |
| Retry | 503 DELIVERY_UNAVAILABLE |
| Recovery | 503 DELIVERY_UNAVAILABLE |
| Status with fabricated capability | 404 NOT_FOUND |
| Closeout with fabricated capability | 404 NOT_FOUND |
| Unsigned webhook | 401 INVALID_SIGNATURE |

All error responses had no-store caching. These checks prove denial and
routing/authentication behavior while disabled, not successful authorized
status, closeout, or signed webhook processing for an active remote release.

Aggregate remote verification found:

- policy limit 90;
- zero ledger rows and zero reserved attempts;
- zero temporary releases;
- all three triggers: enforce_delivery_budget, reserve_delivery_attempt,
  reserve_repeated_submission.

## Remaining controlled-test checklist

1. Keep delivery disabled until a separately agreed, bounded live test using
   tester-controlled inboxes and synthetic release contents is ready.
2. Establish the live send allowance before enabling; do not exhaust the real
   daily budget to test limits already exercised locally.
3. Exercise successful finalization and retained browser controls after a
   deliberately blocked status read; confirm the same transaction is reused.
4. Exercise mixed recipient updates, hidden-tab pause/return, manual refresh
   and progressive timing. Use controlled simulation when provider timing
   cannot reproduce the required ordering reliably.
5. Exercise interrupted-finalization recovery in an isolated fixture. Do not
   corrupt remote stored user documents or add public fault-injection routes.
6. With a valid synthetic release still open, disable delivery again and verify
   authorized status, browser download and closeout; observe signed webhooks
   and scheduled cleanup. Local tests cover these; this smoke run had no active
   release and therefore does not claim their complete remote verification.
7. Measure successful status-request CPU and D1 rows read. The read-only admin
   query timings from this run are not representative endpoint measurements.
8. Record outcomes without secrets, capabilities, contents, recipient addresses
   or provider IDs; verify deletion and leave delivery disabled after testing.

## Failure and rollback guidance

Keep the current disabled configuration as the containment baseline. If smoke
checks fail, keep delivery disabled and diagnose before authorizing sends.
Prefer redeploying a corrected schema-compatible build. Do not blindly roll
back to the recorded previous version: it predates the delivery switch and
budget enforcement. Do not drop tables, clear the ledger, roll back migration
history, or restore a database snapshot merely to revert application code.
Any restoration must account for retained reservations and temporary-data
lifecycle; it is not an automatic step in this test.

The user reaching a conversation usage limit did not interrupt the completed
migration or deployment. The outstanding tool results were collected and
verified successfully afterward.

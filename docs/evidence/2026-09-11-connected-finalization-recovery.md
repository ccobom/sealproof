# Connected finalization recovery — September 11, 2026

## Recovery boundary

The browser now offers an explicit Recover this release action for a retained
`pending_recovery` response or `FINALIZING` status. Both are presented as
incomplete finalization, never as sealed or emailed. Manual status refresh and
existing download/closeout controls remain available.

`POST /api/releases/:transactionId/recover` requires HTTPS, the configured
hostname, the matching Origin, and the existing download/closeout capability.
The read-only status capability cannot authorize recovery. Closed, cleaning,
and expired releases cannot be recovered. Only `DELIVERY_ENABLED="true"`
allows this action. Status reads do not mutate state or initiate delivery.

The endpoint calls the existing resume function. It verifies the stored
ciphertext's size and SHA-256 checksum against D1 metadata before atomically
transitioning `FINALIZING` to `SEALED_AWAITING_DELIVERY`. It preserves the
transaction, exact encrypted object, document hash, admission consumption,
original expiry and two initial delivery-attempt records. It creates no new
reservations; the initial reservations already authorized these attempts.
The normal delivery coordinator continues to verify/decrypt the stored PDF
and enforce accounting for any additional provider calls.

Only the invocation that successfully seals calls the configured initial
delivery handler. Already-sealed recovery requests do not submit again.
Concurrent requests can receive a conflict and safely refresh status. If
execution stops after sealing but before delivery submission, existing pending
submission controls provide the separate, budget-accounted delivery path.
A provider-handler failure does not misreport successful sealing as failed.

If the recovery response reports successful sealing but the following status
read fails, the browser keeps the updated release credentials and tells the
user to refresh the same release's status. It never starts a fresh admission.

## Unavailable or damaged storage

Missing objects return `waiting_for_pdf` (HTTP 202), storage errors return HTTP
503, and integrity failures return HTTP 409. None authorizes delivery or claims
sealing succeeded. Recovery can verify an object written before an interrupted
response, or succeed when temporarily unavailable storage returns. It cannot
restore an object that never arrived or repair corrupt bytes. The interface
provides retry, refresh and closeout guidance without extending expiry.

## Evidence

The route tests inject an interrupted finalization after a successful R2 write
and exercise the connected browser client and Worker router. They verify the
same transaction, hash, ciphertext bytes, expiry and two reservations after
recovery, including at a fully reserved global budget. They also cover absent
and corrupted objects, storage outage, status-only and wrong capabilities,
cross-origin requests, expiry, closeout, disabled delivery, concurrent recovery,
and failure between sealing and delivery invocation.

The existing finalization and browser-retention tests remain applicable.
TypeScript checks for Worker, app and tests pass. The production build passes
with existing dependency annotation/import warnings. This is local automated
evidence, not a rendered-browser or remote CPU/live-delivery measurement.

No migration, new stored capability, automatic recovery job, page-reload
persistence, or upload-resumption protocol is introduced. Mixed-recipient
polling remains a separate open gate. Git commits and deployment remain with
the project owner; no staging, commit, push or deployment was performed.

Final validation: 32 tests passed across recovery-route, core finalization,
browser-retention, application integration, and finalization-client suites.
Worker, app and test TypeScript checks, production build and diff whitespace
checks passed. No full-suite or live deployment claim is made for this slice.

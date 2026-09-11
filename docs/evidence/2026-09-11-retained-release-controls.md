# Retain browser release controls — September 11, 2026

## Defect and change

After a successful finalization response, the browser previously awaited a
separate status request before retaining the transaction and capabilities.
A failed status request therefore left the user on the sealing screen even
though delivery could already have occurred.

The browser now retains the complete finalization response and enters the
release-controls screen before requesting status. Status-read failures are
handled separately from admission/upload failures. The user can refresh status
for the existing release, download the browser-held PDF, or proceed to closeout.
The document hash comes from the retained response even when status is absent.
The sealing handler refuses a new submission once a release has been retained.
No automatic new admission, PDF upload, or delivery retry is added.

When initial status is missing, the interface explicitly describes status as
unavailable and warns that email may already have been sent. Production can
reach the existing download and closeout controls. Manual refresh only reads
status for the retained transaction.

## Evidence

- `tests/worker/retain-release.test.ts` verifies that credentials exist before
  the status fetch begins and survive network failure, HTTP 503, malformed
  JSON, and invalid status data. Each failure makes only one status request.
  A pending-finalization response retains its original outcome and expiry.
- `tests/worker/app-integration.test.ts` performs real local admission,
  encrypted finalization and fake-provider submission, injects an initial
  HTTP 503 status failure, and exercises the existing subsequent status,
  webhook and closeout workflow with the retained credentials.
- The two test files pass all nine tests.
- App and test TypeScript checks pass. The production build passes with the
  existing dependency annotation and static/dynamic import notices.

This evidence tests the browser orchestration helper used by App and the
local Worker integration. It is not an automated rendered-browser walkthrough
or live delivery test.

## Boundary

Capabilities remain only in current browser memory. Reloading or closing the
page is not addressed, and no localStorage, sessionStorage, or cookie retention
is introduced. A finalization response that never reaches the browser also
remains outside this fix.

Connected interrupted-finalization recovery and polling after a mixed
recipient outcome remain separate open readiness gates. No Worker, D1,
budget, delivery-switch, or expiry behavior changes. Nothing was committed,
pushed, migrated remotely, or deployed as part of this work.

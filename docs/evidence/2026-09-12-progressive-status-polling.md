# Progressive delivery-status polling — September 12, 2026

## Selected MVP behavior

Following the owner's review of a hibernating WebSocket relay versus polling,
retain the existing read-only status API and introduce progressively slower
browser polling. No new Cloudflare service, subscription capability, database
schema, or provider call is added.

Poll while either recipient outcome is PENDING, including when the overall
release is DELIVERY_FAILED because the other recipient bounced. ACCEPTED and
DELAYED submissions retain a PENDING recipient outcome. A settled or
UNRESOLVED/conflicting outcome alone does not justify indefinite polling; the
other pending recipient still does. FINALIZING requires explicit recovery and
is not a delivery-polling state. Missing status for a retained sealed release
can be refreshed automatically.

The cadence is based on age since the original finalization, derived from the
unchanged two-hour expiry:

- First minute: five seconds between completed checks.
- Minute one through minute five: 15 seconds.
- Thereafter: 60 seconds, stopping at the original expiry.

Polling runs on both the release and production-closeout screens, stops on
leaving those screens or clearing the release, and pauses in hidden tabs.
Returning to a visible tab triggers a fresh read without resetting the age.
Manual Refresh delivery status is available on both screens. During polling,
manual and automatic requests share an in-flight read. Timers schedule after
completion, so slow reads do not accumulate concurrent automatic requests.

Transient failures preserve the last known status and continue on the same
bounded schedule. Responses arriving after disposal or expiry are ignored.
Neither polling nor manual status refresh initiates sending, recovery, retry,
or cleanup. Existing webhook persistence operates independently of the browser.

## Resource model and evidence

A continuously visible page waiting the full two hours from finalization,
with instantaneous responses and no manual/visibility-triggered refreshes,
makes 142 automatic status reads. This excludes the initial status fetch and
other workflow requests. Hidden time, settled outcomes and network duration
can reduce automatic polling; manual refreshes and repeated tab returns add
requests. This is a client behavior bound, not an abuse limit or a measured
CPU/D1 cost claim.

Fake-timer tests cover mixed failed/pending delivery resolving, progressive
intervals and transient errors, hidden-tab pause and return, slow-request
sharing, ignoring late responses after disposal, expiry, settled/conflicting
outcomes, and the two-hour count. Related browser retention and local Worker
integration tests remain applicable. TypeScript app/test checks and the
production build pass; the build retains existing dependency/import notices.
No rendered-browser walkthrough or remote resource measurement is claimed.

## Future architecture option

Consider a hibernating WebSocket notification relay only if observed status
request/D1 usage threatens the free-tier budget, or slower update latency
becomes a demonstrated product issue. First compare measured polling usage
with relay connection, notification, reconciliation and reconnect overhead.
Any relay proposal must define capability handling, connection limits,
missed-notification recovery, expiry and closeout cleanup. D1 remains the
source of truth. This records an option, not approval to add that architecture.

No staging, commit, push or deployment was performed for this slice.

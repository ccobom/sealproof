# 0037 — Role-Specific Delivery Retry

- Date: September 9, 2026
- Result: Recoverable bounded retry implemented locally

## Question

Can a user retry only a failed recipient's delivery without changing the sealed PDF, losing prior failure evidence, duplicating a retry attempt, extending retention, or allowing unbounded provider cost?

## Authorization and input

`POST /api/releases/{transactionId}/retry` requires the stronger download capability rather than the read-only status capability. The route also requires same-origin HTTPS, bounded strict JSON, an active release that has not begun cleanup, and a currently failed role. Invalid identifiers or capabilities are concealed as not found.

The browser sends only `PRODUCTION` or `SIGNER`. It never sends an address, provider identifier, document hash, expiry, attempt number, attachment ticket, or storage key.

## State behavior

A retry inserts a new `PENDING_SUBMISSION` attempt with the next immutable attempt number. It preserves the failed attempt as history and reuses the existing encrypted PDF, document hash, temporary address envelope, and exact original expiry.

After fake provider acceptance, the new attempt becomes `ACCEPTED`. The affected current role outcome returns to `PENDING`; if the other role is delivered, the overall release returns to `SEALED_AWAITING_DELIVERY`. The prior bounded failure category is cleared while no current role is failed or unresolved.

If the process stops after creating the attempt, another request recovers and submits that same attempt. If provider acceptance occurred before the D1 update, the stored encrypted attachment ticket and provider idempotency key recover the identical request. Repeated browser requests do not create an additional attempt.

## Approved limit

The project owner approved at most two retries per recipient role: three total attempts including the original. The limit is enforced by the Worker, not merely the interface. Status exposes only a bounded retries-remaining count from zero through two. At zero, the interface removes the retry action while preserving browser download and download-and-delete.

The limit reduces accidental loops, abuse, and provider cost. It does not extend the immutable two-hour release window.

## Local interaction

After a mixed fake-webhook outcome, the failed role receives a retry control. Successful fake submission creates attempt 2 and displays role-specific controls for a signed delivered or bounced retry event. The event passes through the existing authenticated webhook processor.

## Automated evidence

Tests establish that retry:

- requires the download capability and refuses exact expiry;
- adds attempt 2 only to the failed role;
- leaves attempt 1 failed and unchanged;
- preserves PDF object key, document hash, and expiry;
- recomputes the current role and overall release outcomes;
- returns the same attempt on a repeated request;
- recovers a pending attempt after synthetic provider interruption; and
- refuses attempt 4 after two retries.

All 155 tests across 34 files passed. The TypeScript checks, Vite production
build, and Cloudflare deployment dry-run also passed.

## Manual evidence

A synthetic loopback release produced `PRODUCTION: DELIVERED` and
`SIGNER: FAILED`. Retrying only the signer:

- created signer attempt 2 while retaining signer attempt 1 as `FAILED`;
- returned the signer outcome to `PENDING` and the release to
  `SEALED_AWAITING_DELIVERY`;
- preserved the exact PDF hash and 7,200,000 millisecond retention window; and
- reached `DELIVERED` for both roles after a signed retry-delivered event.

Before cleanup, D1 contained one production attempt, two signer attempts, and
three processed webhook receipts, with no remaining failure category. After
production closeout, D1 retained only the bounded `CLOSED` / `COMPLETED` audit
record and contained zero temporary, delivery-attempt, or webhook rows. The R2
object was absent, and the browser was reset and closed.

## Next gate

Review and implement the real Resend adapter behind the tested delivery
interface. Do not connect a live credential until the exact request shape,
bounded error mapping, and dry-run tests pass.

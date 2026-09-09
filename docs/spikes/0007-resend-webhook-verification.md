# 0007 — Resend Webhook Verification

- Date: September 8, 2026
- Result: Pass (local synthetic test)
- Related decision: `docs/decisions/0002-release-state-and-audit-data.md`

## Question

Can the Worker authenticate a Resend webhook from its unmodified request body, reject replay-aged or altered requests, extract only approved delivery fields, and prevent unverified input from reaching D1?

## Scope

This spike runs entirely in the local Workers test runtime. It uses a synthetic signing secret, synthetic email addresses, and a local D1 database. It creates no Resend webhook, sends no email, creates no Cloudflare database, and stores no real personal information.

## Implementation boundary

`src/delivery/process-resend-webhook.ts` reads the request body exactly once as text. `src/delivery/verify-resend-webhook.ts` passes that unmodified text and the three required `svix-*` headers to the official Svix verifier. Only after verification succeeds does it parse and normalize:

- the `svix-id` idempotency key;
- one of the five approved delivery event types;
- the Resend provider message ID;
- the provider event timestamp;
- a SHA-256 fingerprint of the exact signed body;
- the local receipt timestamp.

Recipient addresses, subject text, bounce details, and the raw body are not passed to the state processor or stored by this path.

## Evidence

On September 8, 2026:

- all 46 tests across eight files passed;
- all production, test, and browser TypeScript checks passed;
- a correctly signed supported event was normalized and applied to local D1;
- changing the body after signing was rejected;
- signing with a different secret was rejected;
- missing signature headers were rejected;
- a correctly signed request older than the verifier tolerance was rejected;
- correctly signed unsupported and malformed events were rejected;
- a forged request left the delivery attempt unchanged in D1;
- the normalized value contained no recipient address from the provider payload.

The dependency audit reported no advisory in `svix`, `standardwebhooks`, or their production dependency path. Six existing advisories were reported in local development tooling: Vitest, Wrangler/Miniflare, and Sharp. No automatic or forced dependency rewrite was applied.

## Remaining gate

This proves the local authentication and state-processing pipeline, not a live endpoint. Before deployment:

- create a dedicated Resend webhook subscribed only to the five approved events;
- store its signing secret as a Worker secret, never in Git or browser code;
- map verification failures to a bounded HTTP response without logging bodies or secrets;
- test one real signed delivery through the deployed Worker;
- complete the idempotent two-hour cleanup and R2/D1 recovery gates.

## Conclusion

The raw-body verification gate passes locally. An unverified, stale, altered, unsupported, or malformed webhook cannot reach the D1 state mutation function through the tested processing entry point.

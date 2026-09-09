# 0036 — Interactive Fake Webhooks

- Date: September 9, 2026
- Result: Local authenticated delivery outcomes connected

## Question

Can a person exercise successful and mixed-role delivery outcomes in the local browser while every state change passes through the same signature verification, idempotency receipt, and state reducer required for future Resend webhooks?

## Local control boundary

The loopback-only Worker mounts a synthetic control at a path beneath `/api/local/`. The default application Worker does not mount this route. Requests require:

- HTTPS on the configured local hostname;
- an exact same-origin `Origin` header;
- JSON with no unknown fields and a 256-byte maximum;
- the active release's status capability;
- an unexpired release that has not begun cleanup; and
- an accepted current delivery attempt for the selected recipient role.

The browser offers three scenarios: both roles delivered, production delivered with signer bounced, and production bounced with signer delivered. The route never accepts an address or provider identifier from the browser. It selects the role's temporary provider message ID from D1 only after capability authorization.

## Genuine verification path

For each selected role, the local route creates a minimal Resend-shaped event, signs the exact body using the synthetic local Svix secret, and passes the request into `processResendWebhookRequest`. That existing pipeline verifies the signature before parsing or applying the event, stores a duplicate-safe webhook receipt, updates the role attempt, derives both role outcomes, and derives the overall release state.

The local signing secret is intentionally synthetic, checked into local configuration, and unusable for a real Resend webhook. No Resend endpoint, API key, email, or external network request is involved.

## Truthful outcomes

- Fake provider API acceptance remains `PENDING` in the user-facing delivery outcome.
- Two verified delivered events produce `DELIVERED` only after both roles succeed.
- A delivered/bounced pair produces `DELIVERY_FAILED` with independent `DELIVERED` and `FAILED` role outcomes.
- A bounce stores only the bounded category `delivery_bounced`.
- Contradictory terminal events store only `conflicting_provider_events` and produce `DELIVERY_UNRESOLVED`.
- Closeout and two-hour expiry continue to remove provider IDs, encrypted attachment tickets, webhook receipts, addresses, and PDF storage.

## Automated evidence

Integration coverage carries browser-reviewed bytes through admission, sealing, fake provider acceptance, rejection of an incorrect status capability, two independently signed events, signature verification, mixed-role state derivation, bounded status output, and cleanup. It also proves that the default Worker returns `404` for the local fake-webhook path.

All 150 tests across 33 files passed. All TypeScript checks, the Vite production build, and the Cloudflare deployment dry-run passed.

## Manual evidence

Two complete loopback releases used synthetic information only:

1. **Both delivered** produced overall `DELIVERED`, production `DELIVERED`, signer `DELIVERED`, two processed webhook receipts, two delivered attempts, no failure category, and the browser-matching document hash.
2. **Production delivered; signer failed** produced overall `DELIVERY_FAILED`, production `DELIVERED`, signer `FAILED`, two processed webhook receipts, and the bounded `delivery_bounced` category.

After explicit closeout of each release, D1 reported `CLOSED`, `COMPLETED`, `production_closeout`, zero temporary rows, zero delivery-attempt rows, and zero webhook rows. Direct local R2 lookups confirmed that both encrypted PDF objects no longer existed. The browser inputs were then cleared.

## Next gate

Implement retry as a new role-specific delivery attempt without changing the sealed PDF or two-hour expiry.

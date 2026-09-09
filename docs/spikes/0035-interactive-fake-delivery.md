# 0035 — Interactive Fake Delivery Lifecycle

- Date: September 9, 2026
- Result: Browser finalization connected to local fake delivery

## Question

Can the existing browser finalization trigger both production and signer delivery submissions through the validated fake provider without creating a path to Resend or falsely describing provider acceptance as delivery?

## Boundary

The browser-facing finalization handler now accepts an optional post-seal hook. The default application Worker supplies no hook. Only `src/worker/local-app.ts`, which already rejects every non-loopback hostname, injects `runLocalFakeDelivery`.

The hook runs only after PDF storage, encryption, independent hash verification, and the durable transition to `SEALED_AWAITING_DELIVERY` succeed. A post-seal provider error cannot turn that completed document operation into a false finalization failure: the affected attempt remains pending for recovery.

Local fake delivery:

1. loads the temporary addresses from their encrypted envelope;
2. constructs the two role-specific encrypted attachment URLs;
3. asks the fake provider to retrieve and hash each exact PDF;
4. stores separate synthetic provider message IDs; and
5. changes each attempt from `PENDING_SUBMISSION` to `ACCEPTED`.

It does not produce a `DELIVERED` state. The status response continues to show both role outcomes as `PENDING`, because provider API acceptance is not evidence that either recipient mail server accepted a message.

## Security and privacy behavior

- No Resend adapter, API key, live endpoint, or external fetch is connected.
- The fake attachment fetch calls the validated internal handler directly.
- The production-shaped default Worker does not acquire fake or live delivery merely because the optional seam exists.
- Key material is decoded only inside the local hook and byte arrays are overwritten after submission.
- Browser responses expose no addresses, provider identifiers, tickets, encrypted envelopes, or internal failures.
- Existing closeout and scheduled cleanup delete the temporary addresses, provider identifiers, tickets, and encrypted PDF.

## Evidence

The integrated Worker test now carries one synthetic browser-reviewed PDF through admission, finalization, encrypted storage, two fake provider retrievals, two role-specific `ACCEPTED` attempts, bounded status, and verified closeout deletion. It confirms that provider IDs are distinct synthetic identifiers, stored tickets are encrypted, and neither plaintext ticket nor transaction ID appears in the stored ticket envelope.

The manual loopback walkthrough produced `SEALED_AWAITING_DELIVERY` with both user-facing role outcomes correctly remaining `PENDING`. Before closeout, a bounded D1 inspection confirmed two internal `ACCEPTED` attempts, distinct fake provider identifiers, and encrypted ticket envelopes containing no plaintext transaction identifier. No live service received a request.

After explicit closeout, D1 independently reported `CLOSED`, `COMPLETED`, `production_closeout`, zero temporary-release rows, zero delivery-attempt rows, and zero webhook rows while retaining the matching document hash. A direct local R2 lookup reported that the encrypted PDF key no longer existed.

All 148 tests across 33 files passed. All TypeScript checks, the Vite production build, and the Cloudflare deployment dry-run also passed.

## Next gate

Add a local-only fake webhook control so delivery, failure, and mixed-role outcomes can be exercised through the same authenticated event-processing boundary used by future Resend webhooks.

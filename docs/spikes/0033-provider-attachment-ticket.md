# 0033 — Provider Attachment Ticket

- Date: September 9, 2026
- Result: Local encrypted provider retrieval boundary implemented

## Question

Can a future Resend submission retrieve the exact encrypted-at-rest PDF using authority that is recoverable after interruption, scoped to one delivery attempt, separate from browser capabilities, and invalid after cleanup or expiry?

## Implementation

The Worker issues an AES-GCM encrypted ticket containing only transaction ID, attempt ID, recipient role, document hash, issuance time, and release expiry. A dedicated versioned key domain prevents substitution with admission or PDF-encryption tokens. Ticket lifetime cannot exceed the remaining two-hour release window.

The retrieval route accepts the ticket only in a fixed HTTPS path on the configured hostname. It requires every encrypted field to match current D1 attempt and release state, verifies R2 ciphertext identity, decrypts the existing application envelope, validates the plaintext document hash, and rechecks authorization immediately before responding. Responses are private and cache-disabled.

## Storage and disclosure

No provider bearer or bearer hash is added to D1. A fresh ticket can be issued from existing non-secret attempt metadata after interruption. The URL remains sensitive transport metadata and may be processed in Cloudflare and Resend logs; this is an unavoidable consequence of Resend's URL-based attachment interface and requires disclosure.

## Scope

Tests use generated PDFs, synthetic addresses, local D1/R2, and deterministic keys. They verify encrypted payload recovery, role and attempt binding, exact decrypted byte equality, document-hash continuity, expiry, alteration, host rejection, role mismatch, and immediate invalidation after cleanup. The route is mounted in the local application Worker, but no UI generates a ticket and no provider submission or live network request occurs.

## Next gate

Build an injected delivery-submission coordinator that generates one ticket per pending role, supplies two distinct attachment URLs and idempotency keys to a fake Resend adapter, and records only validated provider message identifiers. The fake provider must retrieve and compare both attachments before any real email test.

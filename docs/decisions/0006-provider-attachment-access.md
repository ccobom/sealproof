# 0006 — Provider Attachment Access

- Status: Accepted for local validation
- Date: September 9, 2026
- Decision owner: Project owner
- Validation gate: Encrypted role-scoped ticket and exact-byte local retrieval

## Context

Resend accepts either Base64 attachment content or a public HTTPS `path`. Earlier CPU evidence rejected Worker-side Base64 assembly in favor of provider retrieval. R2 now contains only application-encrypted ciphertext, so the retrieval endpoint must decrypt the exact document while authorizing Resend without exposing the browser's stronger download capability.

Resend's remote attachment request does not provide an application-defined authorization header. Its authorization therefore has to travel in the URL and may appear in provider or infrastructure request logs.

## Decision

Issue a separate encrypted provider attachment ticket for each delivery attempt. The ticket contains only transaction ID, delivery-attempt ID, recipient role, document hash, issuance time, and the immutable release expiry. It contains no name, email address, provider identifier, storage key, document bytes, or browser capability.

The ticket is encrypted and authenticated with AES-GCM under a dedicated, versioned provider-attachment key. It is never stored in D1. Because its inputs are durable and non-secret, SealProof can issue a fresh equivalent ticket after an interrupted submission without storing a recoverable bearer credential.

Retrieval requires all ticket fields to match an active delivery attempt and release. It independently verifies encrypted R2 size and hash, decrypts using the existing PDF envelope, validates the resulting document identity, checks authorization again after decryption, and returns private no-store PDF bytes. Cleanup or expiry makes every outstanding provider ticket unusable even if its URL remains in a third-party log.

## Alternatives

### Reuse the browser download capability

Rejected. It would give a provider-facing URL the browser's broader download authority and couple two independently revocable trust domains.

### Store a random provider capability hash only

Rejected. SealProof would lose the bearer after a crash between recording its hash and completing an idempotent provider submission.

### Store an encrypted random provider capability

Viable but not selected. It adds per-attempt encrypted secret state when an authenticated, scoped, expiring ticket can be reconstructed safely.

### Send Base64 content

Rejected for the current architecture because it increases Worker memory and CPU work and duplicates bytes in the Resend request body. It can be reconsidered only with new representative remote measurements.

## Consequences

- The provider ticket is a bearer credential and must be redacted from application logs.
- Cloudflare and Resend may still process the URL as transport metadata; this must be included in the external-provider disclosure.
- Active and immediately previous provider key versions must remain available for the maximum two-hour ticket lifetime during rotation.
- Provider tickets cannot extend release expiry or survive cleanup.
- A separate ticket is scoped to exactly one role and attempt.

## Outcome

Accepted for local validation. Live Resend submission remains prohibited until the injected provider workflow, key configuration, URL construction, webhook path, and cleanup invalidation pass together.

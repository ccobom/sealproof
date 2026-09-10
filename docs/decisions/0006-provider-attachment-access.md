# 0006 — Provider Attachment Access

- Status: Accepted for local validation
- Date: September 9, 2026
- Decision owner: Project owner
- Validation gate: Encrypted recovery of a short role-scoped capability and exact-byte retrieval

## Context

Resend accepts either Base64 attachment content or a public HTTPS `path`. Earlier CPU evidence rejected Worker-side Base64 assembly in favor of provider retrieval. R2 now contains only application-encrypted ciphertext, so the retrieval endpoint must decrypt the exact document while authorizing Resend without exposing the browser's stronger download capability.

Resend's remote attachment request does not provide an application-defined authorization header. Its authorization therefore has to travel in the URL and may appear in provider or infrastructure request logs.

## Decision

Issue a separate random 256-bit provider attachment capability for each delivery attempt. Its URL-safe encoding is exactly 43 characters and contains no transaction ID, role, document hash, address, provider identifier, storage key, document bytes, or browser capability.

SealProof stores only the capability's SHA-256 hash for authorization. Before provider submission, it also encrypts and authenticates the exact capability with AES-GCM under the dedicated, versioned provider-attachment key. That recovery envelope is bound to its transaction and attempt. The usable capability never appears in D1 plaintext.

This encrypted temporary copy is required because Resend rejects reuse of an idempotency key when any request payload field changes. Issuing a fresh capability would change the attachment URL. Persisting the encrypted original permits an interrupted submission to retry the identical request body without exposing a usable bearer in a database disclosure. The database row—not self-contained URL metadata—binds the capability hash to exactly one active role and attempt.

Retrieval hashes the presented capability and requires its unique row to belong to an active, unexpired release and attempt. It independently verifies encrypted R2 size and hash, decrypts using the existing PDF envelope, validates the resulting document identity, checks authorization again after decryption, and returns private no-store PDF bytes. Cleanup or expiry makes every outstanding provider capability unusable even if its URL remains in a third-party log. Both metadata-only `HEAD` validation and exact-byte `GET` retrieval pass through the same authorization and integrity checks.

## Alternatives

### Reuse the browser download capability

Rejected. It would give a provider-facing URL the browser's broader download authority and couple two independently revocable trust domains.

### Store a random provider capability hash only

Rejected by itself. SealProof would lose the bearer after a crash between recording its hash and completing an idempotent provider submission. The selected design pairs the hash with a separately encrypted recovery copy.

### Store an encrypted self-contained provider ticket

Initially selected after executable recovery testing disproved the earlier reconstruction assumption. A newly encrypted bearer changes the request payload and therefore cannot safely reuse Resend's idempotency key. Controlled live testing later showed that Resend rejected the long self-contained URL before making any attachment request, so the selected design now encrypts a short opaque bearer instead.

### Send Base64 content

Rejected for the current architecture because it increases Worker memory and CPU work and duplicates bytes in the Resend request body. It can be reconsidered only with new representative remote measurements.

## Consequences

- The provider capability is a bearer credential and must be redacted from application logs.
- Cloudflare and Resend may still process the URL as transport metadata; this must be included in the external-provider disclosure.
- Active and immediately previous provider key versions must remain available for the maximum two-hour ticket lifetime during rotation.
- Provider capabilities cannot extend release expiry or survive cleanup.
- A separate capability hash is scoped to exactly one role and attempt.
- Cleanup deletes both the hash and encrypted recovery envelope with the delivery attempt.

## Outcome

Accepted for local validation and first amended after the injected fake provider exposed Resend's identical-payload recovery requirement. Amended again after controlled live testing showed that Resend rejected the long encrypted path before issuing `HEAD` or `GET`, while the earlier short-capability spike had succeeded. The 43-character opaque-capability replacement has complete local integration evidence; live delivery remains unproven until the next controlled retry succeeds.

# 0007 — Direct Resend attachment content

- Date: September 10, 2026
- Status: Accepted for controlled test deployment

## Context

Resend accepted SealProof's live email submissions but rejected both long encrypted and short opaque remote attachment URLs with `invalid attachment paths`. Live Worker tracing showed that Resend did not request either URL before rejecting the messages. The failure is therefore at Resend's attachment-path validation boundary, not PDF retrieval, document integrity, or mailbox delivery.

## Decision

The delivery coordinator retrieves the application-encrypted PDF from private R2, verifies the stored ciphertext, decrypts it transiently, and verifies the exact sealed document hash. It supplies those bytes directly to the delivery adapter. The Resend adapter validates the PDF boundary and hash again, Base64-encodes the bytes, and uses Resend's attachment `content` field instead of `path`.

The same exact decrypted bytes are submitted separately to production and signer. Mutable ciphertext and plaintext buffers are overwritten after submission. No usable provider attachment capability is created, stored, or exposed through the production HTTP router.

All existing recipient separation, provider idempotency keys, authenticated webhooks, retry states, encrypted temporary storage, two-hour expiration, and closeout deletion remain in force.

## Consequences and test gate

This removes the failing remote-path integration and reduces exposure of bearer URLs in infrastructure or provider logs. Resend necessarily receives the PDF content as part of each email request and retains messages according to its own service policy.

Base64 expands the attachment in transit and consumes Worker CPU and memory. Automated correctness tests do not prove that the largest permitted PDF reliably fits the Workers Free per-request CPU limit. The test deployment must measure a representative release and a maximum-size release before this design is approved for production. A resource-limit failure must remain an honest delivery failure and must not mark a message delivered.

# 0034 — Fake Delivery Provider

- Date: September 9, 2026
- Result: Local injected delivery-submission workflow implemented

## Question

Can SealProof exercise the post-sealing delivery boundary without contacting Resend while preserving the same role separation, attachment retrieval, idempotency, and durable acceptance state required by the future live adapter?

## Implementation

`DeliveryProvider` is a narrow injected interface. The submission coordinator loads only active pending attempts, decrypts the two temporary email addresses at send time, issues a distinct encrypted attachment ticket for each role, and supplies a deterministic idempotency key for each attempt. A validated provider message ID moves only that attempt from `PENDING_SUBMISSION` to `ACCEPTED`.

The fake implementation performs real attachment requests against the local provider-attachment route. It requires an exact PDF response, independently hashes the returned bytes, compares the response hash and expected document hash, and then discards the bytes. It stores only non-PII test evidence. It does not send email or call Resend.

## Recovery behavior

The idempotency key is derived from transaction ID, recipient role, and immutable attempt number. Resend requires the retried payload—not merely its meaning—to be identical. SealProof therefore stores the exact provider ticket inside a second AES-GCM envelope bound to its transaction and attempt. Repeating the submission decrypts that temporary envelope, reconstructs the identical attachment URL, and returns the same fake provider message ID without fetching or creating a second message. This permits recovery when provider acceptance succeeds but the following D1 update is interrupted.

One role may succeed while the other fails. The successful attempt remains `ACCEPTED`; the failed attempt remains `PENDING_SUBMISSION` for a later bounded retry. No submission occurs after cleanup begins or at the exact two-hour expiry.

## Evidence

Local tests establish:

- two distinct role-scoped attachment URLs retrieve byte-identical PDFs with the sealed SHA-256 hash;
- production and signer receive distinct provider message IDs;
- API acceptance does not falsely claim webhook delivery;
- rerunning an already-recorded release creates no provider activity;
- simulating provider acceptance followed by a lost D1 write recovers with the same idempotent receipt and no second attachment fetch;
- one rejected role does not erase the other role's acceptance; and
- expiry prevents address decryption, provider submission, and attachment retrieval.

## Scope and next gate

This coordinator is exercised directly in local tests and is not yet invoked by the browser-facing finalization route. The next gate is to inject it into the Worker lifecycle with an explicitly local fake mode, expose only bounded submission state, and prove that a browser finalization causes two fake submissions without enabling any live Resend network request.

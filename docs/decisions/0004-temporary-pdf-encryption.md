# 0004 — Temporary PDF Application-Level Encryption

- Status: Accepted for implementation
- Date: September 9, 2026
- Decision owner: Project owner
- Validation gate: Local cryptographic and storage tests using synthetic PDF bytes

## Context

The finalized PDF contains the names, contact context, agreement, photograph when included, and signature. A private R2 bucket with Cloudflare-managed encryption at rest limits access, but an R2 disclosure or configuration mistake could still expose readable documents. The product owner explicitly wants the service to demonstrate unusually strong respect for signer privacy.

## Decision

SealProof will apply its own AES-256-GCM envelope encryption before a finalized PDF reaches R2.

- Generate an independent random 256-bit PDF data-encryption key for every release.
- Encrypt the exact signer-reviewed PDF bytes using an independent random 96-bit IV.
- Authenticate the transaction ID, plaintext document hash, plaintext size, and envelope version as additional data.
- Wrap the PDF data key with the active versioned key-encryption key held as a Worker secret, using a separate random IV and domain-separated authenticated data.
- Store only PDF ciphertext in R2. Store only the envelope metadata and wrapped PDF key in the temporary D1 row.
- Retain the SHA-256 of the original PDF as the document-integrity hash. R2's object checksum separately validates the stored ciphertext.
- Decrypt only transiently for an authorized download or delivery attachment, then discard the plaintext buffer.
- Delete the ciphertext and wrapped PDF key on explicit closeout or unconditional expiry no later than two hours after finalization.
- Never place plaintext PDF bytes, encryption keys, or envelope material in logs.

The PDF and temporary email-address envelopes use independently generated data keys. Compromise of one stored wrapped key does not supply the other data key.

## Consequences

The current plaintext-R2 finalization coordinator must be revised. Its existing equality between the document hash and R2 checksum will become intentionally invalid: the document hash identifies plaintext PDF bytes, while the R2 checksum identifies ciphertext bytes. Both must be stored and verified in their proper domains.

The Worker must decrypt before giving bytes to Resend or an authorized downloader. Application-level encryption reduces storage-disclosure exposure, but it cannot protect active plaintext from a fully compromised Worker that has access to the key-encryption key.

## Approval record

- Approved by: Project owner
- Date: September 9, 2026
- Notes: The project owner chose application-level PDF encryption as part of making privacy a visible and structural product priority.

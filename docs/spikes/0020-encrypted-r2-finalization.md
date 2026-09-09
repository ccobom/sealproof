# 0020 — Encrypted R2 Finalization

- Date: September 9, 2026
- Result: Local D1/R2 coordinator gate passed
- Related decision: `docs/decisions/0004-temporary-pdf-encryption.md`

## Question

Can the recoverable finalization coordinator preserve the reviewed plaintext document identity while ensuring that only application-encrypted ciphertext reaches R2, with enough immutable temporary metadata to recover safely after interruption?

## Migration behavior

Migration `0002_encrypted_pdf_storage.sql` preserves the explicit identity of any theoretical pre-migration row as `PLAINTEXT_V0`; SQL cannot retroactively encrypt an existing R2 object. New temporary rows are rejected unless they use `ENCRYPTED_V1` and provide the PDF envelope version, key version, document IV, wrapped-key IV, wrapped data key, ciphertext size, and ciphertext SHA-256. Those fields are immutable after insertion.

SealProof has no production D1 release workflow or production rows at this stage. `PLAINTEXT_V0` exists only to make migration semantics honest and recoverable; application finalization never creates it, and recovery refuses to seal it.

## Finalization behavior

The Worker independently validates and hashes the plaintext PDF, then encrypts it with the accepted per-release envelope. D1 atomically stores the plaintext size and document hash in their existing domains plus the wrapped PDF-key metadata and ciphertext identity in the temporary domain.

R2 receives only the ciphertext under a `.pdf.enc` key with `application/octet-stream`. Its supplied SHA-256 checksum is calculated over ciphertext and is intentionally distinct from the retained document-integrity hash calculated over plaintext.

The coordinator reports `SEALED_AWAITING_DELIVERY` only after R2 confirms the ciphertext size and checksum. Interruption recovery applies the same ciphertext-domain checks and rejects legacy plaintext-format state.

## Evidence

On September 9, 2026, six focused D1, R2, recovery, cleanup, and delivery-state test files passed 35 tests. The complete gate then passed all four TypeScript checks, all 102 tests across 21 files, and the Vite production build.

The finalization test reads the stored local R2 object and confirms that it does not begin with the PDF header. It reconstructs the envelope metadata from D1, decrypts the stored object using the correct versioned test key, and confirms exact byte equality with the original PDF. Existing definite-failure cleanup, ambiguous recovery, expiry, capability, webhook, and database-atomicity tests continue to pass.

## Remaining gates

- Add a capability-authorized transient decryption path for download.
- Decrypt transiently for delivery attachment submission without persisting another plaintext copy.
- Replace the rejected multipart browser transport and add an approved anti-abuse initiation boundary.
- Configure and review production D1, R2, key secrets, rotation, and scheduled expiry only after the local HTTP design passes.

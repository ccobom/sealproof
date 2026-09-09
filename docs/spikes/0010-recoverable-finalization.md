# 0010 — Recoverable Finalization

- Date: September 8, 2026
- Result: Pass (local synthetic test)
- Related decisions: `docs/decisions/0001-runtime-and-services.md` and `docs/decisions/0002-release-state-and-audit-data.md`

## Question

Can SealProof independently validate browser-generated PDF bytes, store those exact bytes in private R2 with checksum enforcement, and move durable state from `FINALIZING` to `SEALED_AWAITING_DELIVERY` without falsely reporting success across an R2/D1 interruption?

## Scope

This spike runs entirely in the local Workers runtime with local Miniflare R2 and D1. It uses a small synthetic PDF, synthetic `example.invalid` addresses, and a test-only encryption key. It creates no live Cloudflare or Resend resource, sends no email, and handles no real personal information.

## Sequence

`src/release/finalize-release.ts` performs these steps:

1. Enforce the fixed Worker upload boundary: byte size and PDF header. The reviewed browser generator separately owns full parsing and the three-page rule.
2. Independently calculate SHA-256 over an owned copy of the browser-provided bytes.
3. Reject a mismatch with the browser-calculated hash before creating durable state.
4. Generate a Worker-owned UUID and independent random 256-bit status and download capabilities.
5. Store only capability hashes in D1.
6. Create encrypted D1 release state as `FINALIZING`, using the Worker clock to fix the two-hour deadline.
7. Write the exact bytes to a non-overwriting R2 key while supplying the binary SHA-256 checksum for R2 integrity validation.
8. Verify the returned object size and SHA-256 checksum metadata.
9. Change D1 to `SEALED_AWAITING_DELIVERY` only if the row remains active and unexpired.

Status polling may identify a `FINALIZING` release, but download remains denied until sealing succeeds. The browser does not control the finalization timestamp or retention deadline.

## Recovery behavior

- A definite R2 failure followed by confirmed object absence deletes the unsealed D1 state.
- An ambiguous R2 result or D1 sealing failure remains `FINALIZING`; it is never reported as sealed.
- Recovery checks the stored object’s size and R2-validated SHA-256 metadata against D1 before sealing.
- A missing object remains waiting rather than pretending success.
- A size or checksum mismatch produces an integrity failure and remains unsealed for bounded intervention or expiry.
- Finalization cannot become sealed if the two-hour deadline is reached during storage.
- The existing expiry cleanup removes abandoned `FINALIZING` state and any associated object.

## Evidence

On September 8, 2026:

- all 63 tests across eleven files passed;
- all production, test, and browser TypeScript checks passed;
- valid browser and Worker hashes led to checksum-validated R2 storage and then `SEALED_AWAITING_DELIVERY`;
- R2 stored the expected byte count and SHA-256 checksum;
- raw capabilities returned to the browser matched the hashes stored in D1;
- invalid PDF headers, oversized bytes, and browser/Worker hash mismatches created no durable release;
- a definite R2 write failure with confirmed absence removed the unsealed D1 state;
- a simulated interruption after R2 storage resumed from checksum metadata and sealed successfully;
- status access was available for the interrupted `FINALIZING` row while download access remained denied;
- missing or integrity-mismatched R2 objects could not be sealed;
- reaching exact expiry during storage left the release unsealed and download denied.
- a delivery webhook could not create a receipt, change an attempt, or move a `FINALIZING` release.

## Remaining gates

- Retain monitoring for large-input hashing; the remote evidence and approved trust-boundary adjustment are recorded in `docs/spikes/0011-pdf-size-and-page-limits.md`.
- Define the HTTP request schema and prevent arbitrary clients from choosing workflow versions or cryptographic configuration.
- Load the active key version and key-encryption key from reviewed Worker secret configuration.
- Connect delivery submission only after the coordinator returns `sealed`.
- Run representative browser/device tests and one dedicated non-production Cloudflare integration test before production deployment.

## Conclusion

The local finalization coordinator passes. The code has an explicit durable `FINALIZING` state, uses Worker-owned time and credentials, relies on R2 checksum validation for the exact uploaded bytes, and cannot return a sealed result unless the R2 object and active D1 state agree.

## Encryption amendment

The original spike stored plaintext PDF bytes and used the plaintext document hash as the R2 checksum. That behavior was superseded on September 9, 2026 by application-level PDF encryption in `docs/spikes/0019-local-temporary-pdf-encryption.md` and the integrated coordinator evidence in `docs/spikes/0020-encrypted-r2-finalization.md`. R2 now receives ciphertext only; the plaintext document hash and ciphertext storage checksum occupy deliberately separate integrity domains.

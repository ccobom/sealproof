# 0019 — Local Temporary PDF Encryption

- Date: September 9, 2026
- Result: Isolated local cryptographic gate passed
- Related decision: `docs/decisions/0004-temporary-pdf-encryption.md`

## Question

Can SealProof encrypt exact finalized PDF bytes before storage with independent per-release key material, bind the ciphertext to its transaction and plaintext identity, recover the exact bytes only with the correct versioned secret, and fail closed after alteration?

## Scope

This isolated slice uses only synthetic PDF bytes and in-memory keys in the local test runtime. It does not alter D1 or R2, use a live secret, make a network request, or handle personal information.

## Construction

The implementation uses AES-256-GCM for both document encryption and data-key wrapping. The two operations use independent random 96-bit IVs and domain-separated authenticated data. The document envelope authenticates its transaction ID, plaintext SHA-256, plaintext size, and version. The wrapping envelope authenticates its transaction ID, key version, and distinct PDF-key purpose.

Temporary plaintext copies and raw data-key bytes owned by the encryption function are overwritten in `finally` blocks. JavaScript and WebCrypto do not permit a claim that every runtime-internal copy has been physically erased.

## Evidence

On September 9, 2026, all four TypeScript checks passed, all 102 tests across 21 files passed, and the Vite production build passed. The focused tests demonstrated exact byte recovery, fresh ciphertext and wrapping values for repeated encryption, and fail-closed behavior for altered ciphertext, changed authenticated size, a different transaction ID, a wrong wrapping key, a missing key version, and a false source hash.

## Remaining gates

- D1 and R2 integration passed separately in `docs/spikes/0020-encrypted-r2-finalization.md`.
- Add authorized transient decryption paths for download and delivery separately.

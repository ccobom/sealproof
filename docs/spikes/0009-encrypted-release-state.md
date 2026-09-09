# 0009 — Encrypted Release State

- Date: September 8, 2026
- Result: Pass (local synthetic test)
- Related decision: `docs/decisions/0002-release-state-and-audit-data.md`

## Question

Can SealProof create its D1 release state atomically using the validated encrypted-email envelope, retain multiple key versions for active releases, and prevent plaintext addresses from entering the database?

## Scope

This spike runs entirely in the local Workers test runtime and local D1. It uses synthetic `example.invalid` addresses, synthetic hashes and object keys, and deterministic test-only key-encryption keys. It creates no Cloudflare or Resend resource, performs no network request, and handles no real personal information.

## Creation boundary

`src/release/release-state.ts`:

1. validates identifiers, hashes, timestamps, workflow version, and the private object key;
2. generates and encrypts a new per-release data key using the selected versioned key-encryption key;
3. encrypts both temporary addresses in one transaction-bound AES-256-GCM envelope;
4. inserts the minimal audit row, encrypted temporary row, and one initial attempt for each recipient role in a single D1 batch;
5. fixes expiry at two hours after finalization.

The stored row contains the envelope version, key version, IVs, ciphertext, and wrapped data key. It does not contain the plaintext addresses, raw data key, or key-encryption key.

The guarded loader decrypts an active envelope for delivery work only when cleanup has not started and expiry has not been reached. Its key ring can retain an older key version while new releases use a newer version.

## Evidence

On September 8, 2026:

- all 56 tests across ten files passed;
- all production, test, and browser TypeScript checks passed;
- a release created through the application function stored a decryptable encrypted envelope and exactly two initial delivery attempts;
- neither synthetic plaintext address appeared anywhere in the serialized temporary D1 row;
- releases encrypted with `kek-v1` and `kek-v2` decrypted through the same versioned key ring;
- removing the required old key version caused the older active row to fail closed;
- address loading returned no data after cleanup started;
- address loading returned no data at the exact expiry boundary;
- a forced uniqueness failure in the temporary-row insert rolled back the audit row and both delivery-attempt inserts, leaving no partial D1 release.

## Remaining gates

This spike begins after the browser-generated PDF has already been placed in private R2. Before production:

- build a recoverable finalization coordinator across the non-transactional R2 upload and atomic D1 creation boundary;
- load key-encryption keys from versioned Worker secrets rather than test byte arrays;
- define and test safe operational key rotation and retirement procedures;
- ensure logs and HTTP error responses cannot expose input addresses or cryptographic material;
- replace remaining synthetic-envelope fixtures in unrelated focused tests when shared production fixtures become useful.

## Conclusion

The encrypted D1 release-state gate passes locally. The application’s normal release-creation path now stores real encrypted email envelopes rather than placeholders, supports active rows across key rotation, fails closed after cleanup or expiry, and leaves no partial D1 state when its transaction fails.

## Subsequent resolution

The recoverable R2-upload and D1-finalization coordinator subsequently passed in `docs/spikes/0010-recoverable-finalization.md`.

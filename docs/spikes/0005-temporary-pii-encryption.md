# 0005 — Temporary PII Encryption Spike

- Date: September 8, 2026
- Result: Pass
- Related decision: `docs/decisions/0002-release-state-and-audit-data.md`

## Question

Can the Workers Web Crypto API protect temporary production and signer email addresses with an independently randomized, transaction-bound envelope that supports key rotation and fails closed after alteration?

## Scope

This local-only spike uses synthetic `example.invalid` addresses. It has no network, D1, R2, Resend, or Cloudflare account access and introduces no cryptography dependency.

## Construction

- Generate a fresh random 256-bit data key for every envelope.
- Encrypt a strictly shaped JSON object containing both addresses with AES-256-GCM and a random 96-bit IV.
- Authenticate the envelope version and transaction ID as additional data.
- Encrypt the raw data key with a versioned 256-bit key-encryption key using AES-256-GCM and an independent random 96-bit IV.
- Authenticate the envelope version, key version, and transaction ID during key wrapping.
- Store only version identifiers, Base64 IVs, ciphertext, and the wrapped data key.
- Clear mutable plaintext and raw data-key byte arrays after use, while making no unsupported claim that JavaScript can guarantee memory erasure.

## Required evidence

- Correct round trip with the selected key version.
- Different ciphertext, wrapped key, and IVs for repeated encryption of identical inputs.
- No plaintext address in the serialized stored record.
- Authentication failure with the wrong transaction ID.
- Authentication failure after ciphertext or wrapped-key modification.
- Failure with the wrong key or an unavailable key version.

## Result

On September 8, 2026, all seven encryption-specific tests passed in the local Workers runtime. The complete suite passed 24 of 24 tests, and all production, test, and browser TypeScript checks passed.

The tests demonstrated:

- exact recovery of both synthetic addresses with the correct transaction and key version;
- independently randomized ciphertext, wrapped keys, and both IVs for repeated identical inputs;
- absence of both plaintext addresses from the serialized storage record;
- authenticated failure when the transaction ID changed;
- authenticated failure after alteration of either ciphertext or the wrapped data key;
- authenticated failure with the wrong key-encryption key;
- explicit failure when the required key version was unavailable.

No external resource, secret, real address, or network request was used. The cryptographic construction passes this isolated gate. D1 integration and key rotation across stored rows subsequently passed in `docs/spikes/0009-encrypted-release-state.md`.

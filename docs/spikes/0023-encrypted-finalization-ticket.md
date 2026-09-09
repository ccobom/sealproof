# 0023 — Encrypted Finalization Ticket

- Date: September 9, 2026
- Result: Isolated local ticket-encryption gate passed
- Related decision: `docs/decisions/0005-anonymous-admission-and-abuse-control.md`

## Question

Can SealProof return anonymous admission metadata to the initiating browser as a confidential, tamper-evident, short-lived ticket so an abandoned admission creates no D1 PII record?

## Boundary

After successful bot verification, the Worker may issue a ticket containing a random admission ID, both delivery addresses, the exact browser-reviewed document hash, the server-owned workflow version, and issued/expiry timestamps. The complete payload is encrypted using AES-256-GCM under a separate versioned finalization-ticket secret with a random 96-bit IV.

The envelope version and key version are authenticated additional data. The ticket is canonical unpadded Base64url with a 2,048-character hard limit. Decryption applies strict runtime validation to the plaintext shape and requires expiry to equal exactly five minutes after issuance. The ticket is invalid at the expiry timestamp, not after it.

The encrypted ticket resides only in the browser between admission and immediate upload. It does not enter URLs and must later travel in an authorization-sensitive header. This prevents abandoned admission from creating server-side PII state. Encryption alone does not prevent replay; atomic admission-ID consumption remains a required finalization gate.

Plaintext owned by the ticket functions is overwritten after encryption or parsing. JavaScript and WebCrypto do not permit a claim that every runtime-internal copy has been physically erased.

## Scope

This slice uses only synthetic addresses, hashes, times, and in-memory keys. It creates no D1/R2 state, calls no service, and uses no live credential or personal information.

## Evidence

On September 9, 2026, all four TypeScript checks passed, all 115 tests across 24 files passed, and the Vite production build passed. Focused tests confirmed that the ticket text exposes neither address nor the document hash, repeated issuance produces different authenticated ciphertext, exact metadata recovers under the correct versioned key, expiration occurs at the exact five-minute boundary, and alteration, wrong or missing keys, malformed input, oversized input, invalid email, invalid workflow version, and invalid key size all fail closed.

## Remaining gates

- Bind issuance to the accepted Turnstile verifier in a strict HTTP route.
- Atomically consume each admission ID exactly once during raw-PDF finalization.
- Keep finalization tickets out of URLs, logs, error bodies, and retained audit records.

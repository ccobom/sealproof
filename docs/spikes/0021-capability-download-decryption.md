# 0021 — Capability-Authorized PDF Download and Decryption

- Date: September 9, 2026
- Result: Local authorization and decryption gate passed
- Related decisions: `docs/decisions/0002-release-state-and-audit-data.md`, `docs/decisions/0004-temporary-pdf-encryption.md`

## Question

Can SealProof authorize an exact-PDF download without putting its bearer capability in a URL, reject expired or unavailable releases without exposing which condition occurred, and decrypt ciphertext only transiently after every storage and application-integrity check passes?

## Boundary

The local handler accepts only `GET /api/releases/{transactionId}/document` with the raw download capability in the `Authorization: Bearer` header. The transaction ID identifies the release but grants no access. The capability never enters the URL, where infrastructure and browser history commonly retain values.

The handler hashes the raw capability before querying D1. One query requires the matching digest, a non-finalizing release, an unexpired temporary row, and no cleanup start. Missing, malformed, wrong, and expired capabilities all receive the same cache-disabled `404` response.

After authorization, the handler fetches R2 ciphertext, independently verifies its size and SHA-256 against immutable D1 metadata, and decrypts it using the transaction-bound PDF envelope. Decryption independently validates the resulting PDF header, plaintext size, and retained document hash. It checks authorization again immediately before returning `application/pdf` with a fixed safe filename, the plaintext document hash, and private no-store headers. This second check suppresses a response when cleanup began during fetch or decryption. It cannot revoke bytes from a response whose final authorization check has already completed.

Ciphertext owned by the handler is overwritten in a `finally` block. The returned plaintext necessarily exists in Worker memory while the response is produced; this design does not claim that runtime-internal copies can be physically erased.

## Scope

This handler is not mounted in the deployed Worker entry point. Tests use local Miniflare D1/R2, synthetic addresses, generated PDF bytes, and an in-memory test key. No live resources, credentials, network requests, or personal information are used.

## Evidence

On September 9, 2026, all four TypeScript checks passed, all 106 tests across 22 files passed, and the Vite production build passed. Focused tests confirmed exact authorized PDF recovery and document-hash headers; identical hidden responses for missing, malformed, wrong, and expired capabilities; no-store headers on success and denial; refusal after ciphertext replacement; and method rejection without decryption.

## Remaining gates

- Decide whether production browser downloads should use this header-based fetch followed by a local object URL.
- Build provider-specific attachment retrieval separately because Resend cannot supply the browser's bearer header.
- Mount a production route only after key configuration, anti-abuse, and request-transport decisions are approved.

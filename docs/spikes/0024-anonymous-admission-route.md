# 0024 — Anonymous Admission Route

- Date: September 9, 2026
- Result: Local request-boundary gate passed
- Related decision: `docs/decisions/0005-anonymous-admission-and-abuse-control.md`

## Question

Can SealProof combine strict request validation, same-origin enforcement, server-side bot verification, and encrypted ticket issuance without creating pre-finalization D1 or R2 state?

## Boundary

The local handler accepts only `POST` JSON at the configured HTTPS hostname from the exact corresponding `Origin`. It rejects unsupported methods and media types, declared oversize, actual UTF-8 bodies over 4,096 bytes, malformed JSON, missing fields, invalid values, and unknown fields before consuming a single-use Turnstile token.

All Worker-owned configuration—including the Turnstile secret, expected hostname, workflow version, ticket-key version, and 256-bit ticket key—is validated before Siteverify. Successful verification must match the fixed `release-finalization` action. The handler then returns only the encrypted five-minute ticket and expiry with private no-store headers.

Challenge rejection and provider/configuration unavailability map to bounded public errors. The handler does not log or return addresses, hashes, challenge tokens, secrets, provider payloads, or exception messages.

## Scope

The route is not mounted publicly. Tests inject Siteverify responses and use synthetic addresses, hash, hostname, and key material. The handler has no D1 or R2 environment binding and cannot create durable state. No live service, credential, network request, or personal information is used.

## Evidence

On September 9, 2026, all four TypeScript checks passed, all 120 tests across 25 files passed, and the Vite production build passed. Focused tests confirmed successful challenge verification and decryptable ticket issuance; no-store responses; rejection before Siteverify for unsupported method, wrong origin, wrong media type, unknown fields, invalid email, and both declared and actual oversize; bounded challenge/provider errors; and configuration failure without consuming the challenge.

## Remaining gates

- Atomically consume the ticket admission ID during raw-PDF finalization.
- Add explicit rate controls outside this handler before mounting it publicly.
- Add the browser widget and client request only after the local raw-PDF finalization protocol passes.

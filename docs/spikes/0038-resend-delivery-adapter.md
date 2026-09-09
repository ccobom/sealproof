# 0038 — Resend Delivery Adapter

## Status

Implemented locally without a credential or live network request.

## Question

Can the tested delivery coordinator submit its existing role-specific request to
Resend through a small adapter whose request shape, idempotency behavior,
response validation, and failure mapping are independently auditable?

## Boundary

`ResendDeliveryProvider` implements the existing `DeliveryProvider` interface.
It sends one `POST` to Resend's HTTPS email endpoint with:

- the configured sender and exactly one recipient;
- a fixed subject and plain-text message containing the document hash;
- the existing encrypted, attempt-scoped attachment URL and fixed filename; and
- the coordinator's role- and attempt-specific idempotency key.

The adapter includes the required user-agent. It accepts only a bounded,
strictly validated provider message identifier as success output.

## Failure handling

Raw network errors and Resend response messages are discarded. Callers receive
only a bounded category, whether retry may be appropriate, and a validated
`Retry-After` duration when supplied for rate limiting. Authentication,
invalid-request, quota, transient rate-limit, provider-unavailable, and
malformed-response cases are distinguishable without retaining provider text.

## Credential policy

No Resend credential is present in this implementation or its tests. Production
must use a sending-only key restricted to the verified sending domain, stored as
a Worker secret. The key must never enter browser code, Wrangler configuration,
logs, source control, D1, or R2.

## Next gate

Run all automated checks. Then review production wiring and configuration
validation before creating or installing a live sending key.

## Automated evidence

The adapter's ten mocked-network tests cover its exact success request, bounded
response parsing, provider ID validation, network interruption, and the approved
error categories. No test contains a usable credential or permits a live Resend
request.

All 165 tests across 35 files passed, along with the TypeScript checks and Vite
production build.

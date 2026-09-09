# 0039 — Production Delivery Wiring

## Question

Can initial delivery and role-specific retry use the same tested Resend adapter
without embedding secrets, weakening the local fake boundary, or prematurely
switching the deployed Worker away from the synthetic spike?

## Implementation

`production-delivery.ts` supplies one shared production submission function to
both the post-sealing and retry hooks. It validates and transiently decodes the
PII and provider-ticket key configuration, constructs the Resend adapter from
Worker-only environment values, and then invokes the existing delivery
coordinator. Decoded key buffers are overwritten after each operation.

`production-app.ts` composes these handlers with the application Worker. The
local Worker continues to inject only the fake provider.

## Automated evidence

Mocked-network integration tests confirm that the production handler submits
exactly one message for each role, records only their bounded provider IDs and
`ACCEPTED` states, and leaves the API key and plaintext addresses out of
delivery-attempt storage. Invalid encryption configuration fails before any
provider request. All 167 tests across 36 files and the Vite production build
passed.

## Secret boundary

The API key enters only the Resend authorization header. Tests confirm that the
key and plaintext addresses do not enter delivery-attempt rows. No real key is
present, no live request is permitted, and `wrangler.jsonc` still points to the
synthetic spike rather than this production entry point.

## Next gate

Mount the authenticated Resend webhook on the production application, add
complete startup configuration validation, and prepare a reviewed deployment
configuration before changing the deployed entry point.

# 0040 — Production Resend Webhook Route

## Question

Can the production application expose Resend's authenticated delivery events
without mounting local controls, accepting unbounded bodies, parsing before
verification, or reflecting provider data?

## Implementation

Only the production composition mounts `POST /api/webhooks/resend`. The route
requires the exact HTTPS hostname and JSON media type, rejects bodies above 64
KiB while streaming, and requires a configured Svix signing secret. The exact
UTF-8 request body and required `svix-*` headers are verified before event fields
are normalized or D1 is changed.

Successful, duplicate, and unknown-message events receive the same sparse
`{ "received": true }` response. This prevents the public endpoint from
revealing whether a provider identifier belongs to a SealProof release. Invalid
signatures, malformed events, configuration failures, and internal failures are
mapped to bounded responses with private no-store headers.

## Safety boundary

Tests use a synthetic local signing secret and locally generated Svix
signatures. No Resend webhook or secret was created, and no network request or
deployment occurred.

The focused tests confirm production mounting, authentic acceptance, forged
body rejection, the request-size limit, media-type and hostname enforcement,
missing-configuration failure, sparse responses, and method restrictions. All
172 tests across 37 files and the Vite production build passed.

## Next gate

Add complete production configuration validation and a non-secret reviewed
Wrangler deployment manifest before switching the deployed entry point.

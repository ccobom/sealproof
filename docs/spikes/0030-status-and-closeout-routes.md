# 0030 — Status and Immediate Closeout Routes

- Date: September 9, 2026
- Result: Local capability-authorized lifecycle routes passed

## Question

Can the browser observe delivery progress and explicitly end temporary custody without exposing personal information or allowing a weaker capability to delete a release?

## Status

`GET /api/releases/{transactionId}/status` requires the release's random status capability in the `Authorization` header. The capability is hashed before lookup. A successful response contains only transaction ID, document hash, bounded release state, the two role-level delivery outcomes, bounded failure category, and the hard expiry time. It contains no names, email addresses, provider identifiers, storage keys, document bytes, encryption metadata, or raw capabilities.

Missing, malformed, incorrect, expired, closed, and cross-host requests receive the same private, cache-disabled `404` response.

## Closeout

`DELETE /api/releases/{transactionId}` requires the stronger download capability plus the exact HTTPS origin. The status capability cannot authorize deletion. After authorization, the existing cleanup coordinator first marks cleanup as started, immediately invalidating temporary access; deletes the encrypted R2 object; confirms its absence; deletes temporary D1 state; and records only the completed audit outcome and one-year audit expiry.

This endpoint represents production closeout only. “Download and delete” remains a browser-orchestrated sequence to be designed separately so the application never claims a download happened merely because cleanup ran.

## Scope and evidence

Tests use generated PDFs, synthetic addresses, local D1/R2, and in-memory test keys. They confirm bounded non-PII status, concealed unauthorized and expired access, privilege separation between capabilities, exact-origin closeout, ciphertext deletion, temporary-state deletion, and retained minimal closeout audit state. No live resource, credential, email, network request, or personal information is used.

## Next gate

Add typed browser status and closeout clients, then connect final review through local finalization, status display, and immediate closeout as one interactive synthetic-only slice.

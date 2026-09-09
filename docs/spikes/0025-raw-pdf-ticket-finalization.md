# 0025 — Raw PDF Ticket Finalization

- Date: September 9, 2026
- Result: Local raw-transport and replay gate passed
- Related decisions: `docs/decisions/0003-http-finalization-boundary.md`, `docs/decisions/0004-temporary-pdf-encryption.md`, `docs/decisions/0005-anonymous-admission-and-abuse-control.md`

## Question

Can SealProof replace the rejected multipart transport with a bounded raw-PDF request, recover its encrypted admission metadata, prevent ticket replay atomically, and invoke the encrypted finalization coordinator without placing addresses in headers or URLs?

## Transport

The local route accepts only `POST application/pdf` at the configured HTTPS hostname and exact corresponding `Origin`. The encrypted five-minute ticket travels in the standard `Authorization` header under the `SealProofTicket` scheme; plaintext addresses and the document hash do not. The PDF remains the raw body, avoiding multipart parsing and Base64 expansion.

Configuration and declared size are checked before ticket processing. The ticket is authenticated and checked for expiry before the body is read. Actual bytes remain bounded at 3,000,000 and must independently hash to the document identity authenticated inside the ticket.

## Replay prevention

Migration `0003_consumed_admissions.sql` adds a minimal temporary table containing only the random admission UUID, resulting transaction ID, and consumption timestamp. Its primary-key constraint prevents duplicate admission IDs.

Admission consumption is part of the same D1 batch that creates the audit row, encrypted temporary state, and initial delivery attempts. A concurrent duplicate causes the entire losing batch to roll back. The losing request stores no R2 object and receives the same bounded invalid-ticket response. The replay row cascades away with temporary state after cleanup, by which point the five-minute ticket has long expired.

A hash-mismatched PDF is rejected before admission consumption, allowing the browser to retry its same still-valid ticket with the exact reviewed bytes.

## Scope

The route remains disconnected from the public Worker entry point. Tests use generated PDF bytes, encrypted synthetic addresses, local Miniflare D1/R2, and in-memory test keys. No live service, credential, network request, or personal information is used.

## Evidence

On September 9, 2026, all four TypeScript checks passed, all 125 tests across 26 files passed, and the Vite production build passed. Focused tests confirmed successful raw-PDF finalization into ciphertext-only R2 storage; exactly one winner from simultaneous same-ticket submissions; bounded replay denial; hash-mismatch rejection without ticket consumption; expired, altered, cross-origin, and unsupported-request rejection; declared and actual size enforcement; and private no-store responses. Cleanup also removes the temporary replay marker through its foreign-key cascade.

## Remaining gates

- Re-measure raw-body Worker CPU remotely with synthetic maximum-size input before approving Free-plan compatibility.
- Add rate controls before mounting either anonymous route publicly.
- Connect the browser only after remote CPU evidence and production configuration review.

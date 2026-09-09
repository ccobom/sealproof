# 0031 — Interactive Local Finalization

- Date: September 9, 2026
- Result: Interactive local browser-to-Worker lifecycle connected

## Question

Can a person approve the exact browser-generated PDF, send those bytes through the local production-shaped boundary, inspect bounded Worker status, and explicitly delete temporary storage without making this test behavior available on a non-local host?

## Interaction

On `localhost` and loopback addresses, the exact final-review screen now explains the local custody change before offering **Seal this exact PDF locally**. The browser requests an encrypted admission ticket with a synthetic local challenge proof, uploads the already-reviewed bytes, requires the Worker-returned hash to match, then reads status using the less-privileged status capability.

The resulting screen shows only the transaction ID, document hash, bounded Worker state, and role-level delivery outcomes. It offers the existing in-browser PDF download and a distinct **Delete Worker copy and close test** action. The interface reports deletion only after the capability-authorized closeout endpoint confirms success. A failure retains the release credentials in memory and offers another attempt rather than claiming cleanup.

After confirmed closeout, the final action overwrites the browser's mutable PDF, preview, and photograph byte arrays before dropping the remaining references and inputs.

## Host and service boundary

The interactive sealing action is rendered only on loopback hosts. Non-local builds retain the prior no-upload review path. The local Worker substitutes a synthetic successful Turnstile result and uses only local D1/R2 with deterministic test keys. No email is sent and no live service is contacted.

The local banner and pre-seal notice explicitly require synthetic information and disclose that encrypted bytes enter this computer's local Worker storage until closeout. This is test evidence, not production sealing or delivery.

## Evidence

Client tests verify status and closeout request methods, capabilities, cache behavior, omitted credentials, refused redirects, strict response shapes, and transaction/hash binding. Existing integration tests cover the mounted admission, finalization, status, and closeout path through local encrypted storage and deletion. The Vite production build confirms the React connection compiles.

The first manual browser attempt exposed an origin-comparison defect before ticket issuance: the local browser correctly included port `8787`, while the route constructed an origin without it. Admission returned `400`, and no PDF or release state was created. All mutation routes were corrected to require `Origin` to equal the already hostname-validated request URL's complete origin, retaining strict production same-origin enforcement while accounting for explicit ports. A regression test covers this boundary.

After that correction, the manual walkthrough completed admission (`201`), finalization (`201`), status (`200`), and closeout (`200`). The browser displayed `SEALED_AWAITING_DELIVERY`, two honest `PENDING` delivery outcomes, and the same reviewed SHA-256 identity. After closeout, a read-only local D1 query confirmed `CLOSED`, `COMPLETED`, `production_closeout`, and no temporary row. The cleanup route had already confirmed R2 ciphertext absence before returning success. The tester then cleared browser inputs and closed the window.

All 139 tests across 30 files passed when split into two equal file batches to avoid an intermittent Windows runner resource termination; all TypeScript checks and the Vite production build also passed.

## Next gate

Run the interactive path manually through `npm.cmd run dev:local`, including local seal and confirmed deletion. Before production deployment, add automatic scheduled expiry, production Turnstile UI/configuration, delivery submission, webhook mounting, retry behavior, and production secrets/bindings review.

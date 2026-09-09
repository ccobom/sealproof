# 0003 — R2 Lifecycle and Attachment-Encoding Spike

- Date: September 8, 2026
- Result: Functional pass; combined request does not have reliable Free CPU margin
- Related decision: `docs/decisions/0001-runtime-and-services.md`

## Question

Can a Worker receive the exact browser-generated PDF, store and retrieve it from private R2, verify its SHA-256 hash, encode it as a Resend-compatible Base64 attachment, and delete the temporary object while remaining within the Workers Free 10 ms CPU limit?

## Scope

The spike used a synthetic 40,858-byte PDF. It did not receive personal information, retain an object, use a Resend credential, or send email.

For deliberately strong lifecycle evidence, one request performed every operation: input hash, R2 write, R2 retrieval, stored-byte hash, Base64 encoding, Resend-compatible JSON serialization, R2 deletion, and a final deletion check.

## Evidence

On September 8, 2026:

- all 14 Worker-runtime tests passed;
- all production, test, and browser TypeScript checks passed;
- R2 returned the same 40,858 bytes that the Worker received;
- the input and stored SHA-256 hashes both equaled `61b90b6108ffcebafb19fe1a297eb378f875afb05755f14fe816aa17ea51dd70`;
- Base64 output was 54,480 characters and the representative serialized attachment body was 54,555 bytes;
- every remote request returned success and verified object deletion before responding;
- a compact ten-request sample reported CPU times of 9, 5, 5, 4, 4, 6, 10, 5, 8, and 6 ms (mean 6.2 ms; median 5.5 ms);
- the preceding sample included observed 13 ms invocations, so the path did not remain reliably at or below 10 ms.

The deployed version was `d0efb6c8-15c6-45df-ac2b-0581159649cd`. The temporary Worker and bucket were deleted after measurement.

## Interpretation

Private R2 storage, exact-byte retrieval, hash equality, Resend-compatible encoding, and verified deletion all function correctly. The compact sample is encouraging, but occasional 13 ms results leave insufficient Free-plan margin even for a small PDF. Base64 work also scales with document size, so the representative 40,858-byte result cannot approve larger production documents.

The test intentionally combined lifecycle operations that will not all necessarily share one production request. Any separation must follow real product state transitions rather than artificially divide work to evade CPU limits. A promising alternative is for Resend to retrieve the attachment through a short-lived, capability-protected streaming endpoint backed by private R2, avoiding Worker-side Base64 serialization. That approach requires its own privacy, authorization, exact-byte, provider-fetch, expiry, and CPU test.

## Conclusion

The storage lifecycle passes functionally. Worker-side Base64 attachment preparation is not yet approved for the Free plan. No Resend credential should be connected until the attachment-transfer design is selected and tested.

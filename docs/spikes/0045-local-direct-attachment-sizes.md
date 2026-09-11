# 0045 — Local Direct-Attachment Size Boundary

- Date: September 10, 2026
- Result: Functional pass; remote CPU margin remains unproven
- Related decision: `docs/decisions/0007-direct-resend-attachments.md`

## Question

Can the current production-shaped delivery path retrieve an application-encrypted synthetic PDF from R2, authenticate and decrypt it, verify its sealed hash, encode it as direct Resend attachment content, and create two separate accepted delivery attempts across the full permitted size range?

## Scope

The test runs in the local Cloudflare Workers test runtime with local D1 and R2 bindings. It uses deterministic synthetic bytes beginning with a PDF header, `example.invalid` addresses, test-only encryption keys, and a mocked Resend API. It sends no email, contacts no external service, and handles no real personal information.

Five document sizes are exercised independently:

- 40,858 bytes;
- 500,000 bytes;
- 1,000,000 bytes;
- 2,000,000 bytes; and
- 3,000,000 bytes, exactly the current maximum.

Each case uses `finalizeRelease` and the production delivery handlers rather than testing the Base64 helper in isolation.

## Evidence

On September 10, 2026:

- all five size cases passed;
- each synthetic document was sealed into application-encrypted R2 storage;
- the delivery path retrieved, authenticated, decrypted, and revalidated the document;
- both role-specific Resend requests contained direct `content` and no attachment `path`;
- the PDF was Base64-encoded once at the coordinator boundary with the mathematically expected encoded length;
- production and signer request bodies contained identical attachment content; and
- both independent delivery attempts reached provider-accepted state in D1.

After adding this test, the complete suite passed: 40 test files and 201 tests.

## Interpretation

The current direct-content design is functionally correct in the local Worker runtime at every tested size, including the 3 MB product boundary. The result also provides regression protection against accidentally restoring a remote attachment URL or sending different bytes to the two roles.

This is not a Cloudflare Free CPU approval. Local test duration and desktop resource use do not represent remote per-invocation CPU accounting. The next gate must run an isolated, bearer-protected, synthetic-only measurement in the remote Workers runtime. It should avoid Resend until the largest passing sizes are known, then use the smallest number of live emails needed to verify provider acceptance.

## Conclusion

**Functional size gate passed locally.** No document-size reduction is justified by correctness or local memory behavior at this stage. The 3 MB limit remains provisional until remote CPU evidence is collected.

# 0011 — PDF Size and Page Limits

- Date: September 8, 2026
- Result: Size and page contract passed locally; server-side parsing failed the remote Free CPU gate
- Related decision: `docs/product-contract.md`, Final document limits

## Question

Can a representative three-page SealProof release, including a photograph and vector signature, remain comfortably below a fixed 3,000,000-byte ceiling? Can the finalization boundary reject malformed, oversized, or overlong PDFs without trusting values supplied by the browser?

## Approved contract

- A SealProof-generated final PDF contains no more than three pages.
- A final PDF contains no more than 3,000,000 bytes.
- Content is never silently truncated to satisfy either limit.

## Scope

This spike runs locally with synthetic text, identity fields, photograph bytes, and signature points. The document prominently labels itself as test content. It creates no live resource, sends no email, and handles no real personal information.

## Representative document

`src/document/create-representative-release.ts` generates a three-page document with:

- production, project, signer, and transaction fields;
- fifteen synthetic agreement sections approximating a substantial release;
- a 1280 × 960 JPEG photograph;
- a vector signature; and
- PDF object streams disabled, which avoids relying on their compression for the measurement.

The boundary case uses the already-approved maximum 2,000,000-byte photo input and the maximum 2,000-point vector signature.

## Evidence

On September 8, 2026:

- the representative PDF was 46,374 bytes and three pages;
- the maximum-input PDF was 2,013,402 bytes and three pages;
- the maximum-input case had 986,598 bytes of headroom below the approved ceiling;
- one-, two-, and three-page PDFs passed the final-PDF contract;
- a four-page PDF was rejected;
- a valid PDF of exactly 3,000,000 bytes passed;
- a PDF of 3,000,001 bytes was rejected;
- bytes beginning with a PDF-like header but containing no parseable PDF were rejected; and
- finalization applied the same fixed contract before hashing or storage.

### Remote Cloudflare CPU measurement

With explicit approval, version `47514d82-c434-49ae-9030-4666db7b79d7` was temporarily deployed as `sealproof-pdf-validation-spike`. It exposed one bearer-token-protected synthetic route, had 100% invocation logging, and had no R2, D1, email, or other service binding.

The route performed the proposed production boundary work: receive the bytes, parse them with `pdf-lib`, enforce the fixed contract, and calculate SHA-256. A final clean sample produced:

| Input | CPU times | Mean | At or below 10 ms |
| --- | --- | ---: | ---: |
| 40,858-byte valid PDF | 1, 3, 2, 6, 2, 1, 2, 1, 3, 1 ms | 2.2 ms | 10 of 10 |
| 2,013,402-byte valid padded PDF | 20, 12, 16, 12, 12, 12, 14, 12, 12, 14 ms | 13.6 ms | 0 of 10 |

All twenty requests returned `200`, and the authorization value was redacted in Cloudflare's tail output. Successful responses are not treated as proof of reliable Free-plan compliance: every large-input observation exceeded the nominal 10 ms request allowance.

The large input was the valid 40,858-byte synthetic PDF padded to the representative maximum-input byte length. This isolates the effect of accepting a large valid body, but it does not reproduce the exact object complexity of the locally generated maximum-input document.

One earlier large request failed in the local HTTP driver before producing a response and is excluded. A preceding unfiltered sample was also excluded from the formal table because its full CPU series could not be captured without truncation.

The temporary Worker and its secret were deleted immediately after measurement. Its former URL returned `404`. Cloudflare may retain synthetic invocation and connection metadata for its normal log-retention period; none of that metadata or the temporary secret is stored in the repository.

## Consequence and remaining gate

The browser generator has adequate size headroom, but full server-side parsing at the permitted large-input boundary is not accepted for the production free-tier design. The approved product contract currently says the Worker independently parses and enforces page count, so code and contract must not silently diverge.

Before changing that contract, isolate remote SHA-256 cost at the same byte boundary. Then choose explicitly between:

- enforcing the three-page generation rule in the reviewed browser generator and signer preview, while retaining the Worker's inexpensive byte-size, header, and exact-byte hash boundaries;
- adopting a genuinely lightweight, narrowly reviewed server-side page-count validator and testing hostile PDF inputs; or
- accepting Workers Paid for full `pdf-lib` parsing.

The fixed 3,000,000-byte Worker boundary remains mandatory in every option.

### Hash-only follow-up

On September 9, 2026, temporary version `e89dfbfc-96b4-4499-a12c-7d71940bbb8b` added an authenticated hash-only branch to the same isolated Worker. It received the same 2,013,402-byte synthetic input and performed request-body reading plus SHA-256 without `pdf-lib` parsing.

After five warmups, twenty measured requests reported CPU times of:

```text
4, 4, 4, 12, 4, 4, 3, 4, 4, 4, 5, 11, 5, 4, 4, 4, 4, 5, 5, 4 ms
```

- mean: 4.9 ms;
- median: 4 ms;
- minimum: 3 ms;
- maximum: 12 ms; and
- invocations at or below 10 ms: 18 of 20.

All requests completed successfully. This is strong evidence that byte-size enforcement and exact-byte hashing are viable on the intended Free plan, with substantially more typical CPU headroom than full parsing. It is not a guarantee that every invocation will remain at or below 10 ms, so production monitoring and failure-safe behavior remain required.

The temporary Worker and its replacement secret were deleted after measurement, and its former URL returned `404`.

## Approved trust-boundary adjustment

On September 9, 2026, the project owner approved the free-tier design supported by the follow-up evidence:

- the reviewed browser generator owns full parsing, the maximum three-page layout, and the exact signer preview;
- the Worker independently owns the 3,000,000-byte ceiling, PDF-header check, exact-byte SHA-256 calculation, R2 checksum validation, and sealing transition; and
- SealProof does not claim that the Worker proves page count for bytes submitted by a modified or hostile client.

This preserves the resource-abuse and byte-integrity boundaries on the server without presenting an unaffordable parsing step as a security guarantee.

## Conclusion

The three-page, 3,000,000-byte product contract passes its local correctness and representative-size tests. Full `pdf-lib` validation does not reliably fit the intended Free-plan CPU budget at the large-input boundary, so its current placement in the Worker fails that architectural gate and requires an explicit follow-up decision.

# 0011 — PDF Size and Page Limits

- Date: September 8, 2026
- Result: Partial pass (local synthetic test)
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

The observed test durations are local wall-clock measurements, not Cloudflare Worker CPU measurements. They do not establish eligibility for Cloudflare's free plan.

## Remaining gate

The browser generator has adequate size headroom. Server-side parsing is deliberately retained for independent page-count and parseability enforcement, but it must be measured in a dedicated remote synthetic Worker test before this implementation is accepted for the production free-tier design. If it exceeds the plan's CPU allowance, page-count enforcement must be redesigned or the operating-cost decision revisited; the 3,000,000-byte server boundary remains inexpensive and mandatory either way.

## Conclusion

The three-page, 3,000,000-byte product contract passes its local correctness and representative-size tests. The spike remains a partial pass because local wall time cannot answer the separate Cloudflare CPU question.

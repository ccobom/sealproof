# 0002 — Browser PDF and Worker Hash Spike

- Date: September 8, 2026
- Result: Pass for exact-byte integrity and Worker CPU; email delivery remains open
- Related decision: `docs/decisions/0001-runtime-and-services.md`

## Question

Can the browser construct the representative PDF, hash its exact bytes, upload those bytes to a Cloudflare Worker, and receive an independently calculated matching hash while keeping the Worker safely within the Free plan's 10 ms CPU limit?

## Scope and trust boundary

The spike uses only synthetic data and does not store or email the PDF. The browser creates the PDF and calculates its first SHA-256 value. The Worker accepts at most 5 MB with an `application/pdf` content type, checks the PDF header, calculates SHA-256 over the received bytes, and returns the hash and byte count.

This proves that the browser and Worker operated on the same exact bytes. It does not prove that an untrusted browser faithfully represented structured release fields inside the PDF. Adopting this design therefore requires a product contract in which the signer approves the exact displayed document, plus a separate decision about how the final application makes that review meaningful.

## Evidence

On September 8, 2026:

- the production browser bundle built successfully;
- all three TypeScript configurations passed;
- all 13 Worker-runtime tests passed;
- the browser generated a 40,858-byte synthetic PDF;
- browser and Worker hashes both equaled `f694c5dc648507ffe539d29384f15f671783eb4fc2d47a716694837932edae6b`;
- the page reported `PASS` for both byte length and SHA-256 equality;
- 30 additional remote synthetic uploads all returned successful outcomes;
- sampled remote hash-only invocations reported approximately 0–1 ms of CPU time;
- no PDF storage or email delivery occurred.

The deployed version was `6f2d77ac-410a-41e2-ade7-2a6e1e89e754`. The temporary Worker was deleted after measurement.

## Conclusion

Browser-side PDF generation removes the demonstrated PDF-construction CPU bottleneck. The hash-only Worker has substantial measured margin beneath the Workers Free CPU limit for the representative 40,858-byte document.

This does not yet establish that the complete finalization pipeline fits the Free plan. The next gate is to test storage and Resend attachment handling using the same exact bytes, while preserving the two-hour deletion rule and avoiding unnecessary encoding work in the Worker.

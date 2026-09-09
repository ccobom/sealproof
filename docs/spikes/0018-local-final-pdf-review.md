# 0018 — Local Final PDF Review

- Date: September 9, 2026
- Result: Automated gate and initial manual exact-document review passed
- Related contracts: `docs/product-contract.md`, `src/document/pdf-contract.ts`

## Question

Can SealProof connect its locally collected production setup, signer agreement, optional photo policy, processed photo, and bounded vector signature into one exact final PDF, validate it, calculate its SHA-256, and provide an honest correction and review step without uploading or sealing anything?

## Approved boundary

- The generator revalidates production setup, signer details and affirmative agreement, required-photo presence, any supplied JPEG, and the vector signature.
- The local document has two fixed-purpose pages: agreement and identity details, then photo evidence or explicit waiver plus signature.
- The browser fully parses the generated PDF and enforces the three-page and 3,000,000-byte contract before displaying it.
- SHA-256 is calculated over the same byte array used by the preview and download.
- The hash is displayed outside the PDF because embedding a document's own hash in those same bytes would be circular.
- Correcting signer inputs invalidates and clears the downstream photo, signature, PDF, and hash.
- Nothing is uploaded, remotely stored, emailed, or described as sealed.

## Evidence

On September 9, 2026, all four TypeScript checks passed, all 98 tests across 20 files passed, and the Vite production build passed. New tests confirmed a valid two-page document and 64-character SHA-256 with a photo, a valid two-page production-waiver document without a photo, and rejection when a required photo is absent.

The initial browser walkthrough displayed the completed PDF successfully. The downloaded PDF's independently calculated SHA-256 matched the value displayed by SealProof, confirming download equivalence for that run.

The production-waiver branch, correction behavior, and narrow-screen review remain manual claims.

## Remaining gates

- Inspect both the photo and production-waiver PDF branches.
- Correct signer inputs and confirm all dependent evidence must be collected again.
- Connect only the exact reviewed bytes to the encrypted temporary-upload boundary in a separate slice.

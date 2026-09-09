# 0017 — Local Vector Signature Capture

- Date: September 9, 2026
- Result: Automated gate passed; manual pointer-input test pending
- Related contract: `src/document/signature-contract.ts`

## Question

Can SealProof collect a signer drawing with mouse, touch, or pen input directly into the already-audited bounded vector format, keep it in browser memory, and prevent an empty or single-tap mark from advancing?

## Approved behavior

- Signature collection occurs only after the signer has reviewed and agreed to the release.
- Pointer coordinates are normalized between zero and one, so resizing the display does not change the recorded geometry.
- The existing contract limits stroke count, points per stroke, and total points.
- A tap without a drawn line is discarded, an empty signature cannot advance, and the signer can clear and redraw.
- No signature bitmap is created and no signature data is uploaded, stored, emailed, or sealed in this slice.

## Implementation

The canvas is a rendering surface only. Normalized vector strokes are the source of truth. Pointer events provide one input path for mouse, touch, and pen; pointer capture keeps an active stroke coherent when the pointer approaches the edge. Resize-aware, high-density rendering redraws from the vector source without changing it.

The local completion screen explicitly says that the captured inputs have not created a contract. Ending the test clears the React state holding the signature and all other signer inputs.

## Evidence

On September 9, 2026, all four TypeScript checks passed, all 95 tests across 19 files passed, and the Vite production build passed. Existing signature-contract tests exercise accepted bounded input and rejection of invalid coordinates, non-finite values, excess strokes, and excess points. Actual mouse, touch, and pen behavior remains a manual browser/device claim.

## Remaining gates

- Draw, clear, redraw, and attempt to continue empty in a real browser.
- Test mouse and touchscreen input; test pen input when suitable hardware is available.
- Add the validated vector signature to the exact final PDF in a separate reviewed slice.

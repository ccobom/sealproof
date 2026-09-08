# Image Contract

- Status: Proposed and validated by the local PDF spike
- Date: September 8, 2026

Images arriving at the Worker are untrusted bytes. A browser filename, extension, or MIME type is not proof of format.

## Photo

- Encoding: JPEG
- Maximum longest edge: 1280 pixels
- Target size: less than 1 MB
- Hard size limit: 2 MB
- Browser responsibility: resize and re-encode before submission
- Worker responsibility: verify JPEG bytes, dimensions, size, and absence of prohibited application metadata before embedding

The photo must not carry EXIF or location metadata into the finalized PDF. The current spike rejects JPEG APP1 metadata rather than attempting to preserve or interpret it.

## Signature

- Encoding: normalized vector strokes rather than a raster image
- Maximum strokes: 20
- Maximum points per stroke: 250
- Maximum total points: 2,000
- Coordinates: finite numbers from zero through one on both axes
- Worker responsibility: validate all bounds and convert the strokes to a PDF path

The browser may render the strokes onto a canvas for signer feedback, but the canvas bitmap is not the source sent to the Worker. Normalized coordinates keep capture independent of screen resolution. The Worker renders the validated strokes directly into the PDF and must not retain them after the approved temporary lifecycle.

## Trust boundary

Browser preprocessing improves usability and reduces upload and Worker CPU costs, but it is not a security control. The Worker must enforce the contract again before finalizing a document.

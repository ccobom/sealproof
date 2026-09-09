# Image Contract

- Status: Browser behavior approved; byte contract validated locally
- Date: September 9, 2026

Images arriving at the Worker are untrusted bytes. A browser filename, extension, or MIME type is not proof of format.

## Photo

- Encoding: JPEG
- Maximum longest edge: 1280 pixels
- Target size: less than 1 MB
- Hard size limit: 2 MB
- Browser responsibility: resize and re-encode before submission
- Worker responsibility: verify JPEG bytes, dimensions, size, and absence of prohibited application metadata before embedding

The photo must not carry EXIF or location metadata into the finalized PDF. The current spike rejects JPEG APP1 metadata rather than attempting to preserve or interpret it.

### Browser capture behavior

- Camera access begins only after an explicit signer action and requests video without audio.
- The signer may choose the preferred front or rear camera, subject to browser and device support.
- The captured frame is resized to a maximum 1280-pixel edge and re-encoded through a canvas as JPEG, removing source EXIF rather than copying it.
- Encoding aims for no more than 1,000,000 bytes and must satisfy the unchanged 2,000,000-byte hard limit.
- The signer sees the processed image and may retake or clear it before continuing.
- Active camera tracks stop after capture, on failure, and when the component closes.
- Captured bytes and preview URLs remain in browser memory only in the current slice and are cleared when the local test ends.
- Camera failure or denied permission blocks the step when production marked the photograph as required. Production may instead waive the photograph during setup, before handoff; that choice is displayed to the signer and recorded in the document. File or gallery upload is not treated as equivalent to a current signer photograph.

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

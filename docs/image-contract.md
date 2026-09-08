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

- Encoding: PNG
- Maximum dimensions: 900 by 300 pixels
- Hard size limit: 250 KB
- Worker responsibility: verify PNG bytes, dimensions, and size before embedding

The production implementation must separately decide whether to accept a raster signature or preserve validated signature strokes as vector data. This spike validates only the raster PNG path.

## Trust boundary

Browser preprocessing improves usability and reduces upload and Worker CPU costs, but it is not a security control. The Worker must enforce the contract again before finalizing a document.

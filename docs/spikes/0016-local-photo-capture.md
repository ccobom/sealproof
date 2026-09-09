# 0016 — Local Photo Capture

- Date: September 9, 2026
- Result: Automated gate passed; manual device-camera test pending
- Related contract: `docs/image-contract.md`

## Question

Can SealProof request a current signer photograph transparently, resize and re-encode it into the approved JPEG contract, keep it in browser memory, and provide honest recovery behavior without treating gallery upload as equivalent evidence?

## Approved behavior

- A signer photograph is required by default.
- Production may waive it during setup before device handoff.
- The setup PDF and signer review display whether it is required or waived.
- When required, camera denial or failure cannot be silently bypassed.
- When waived, the signer may still take a current photo or explicitly continue without one.
- File and gallery upload are not an equivalent fallback.

## Browser behavior

Camera access begins only after an explicit click and requests video without audio. The signer may request front or rear facing mode, review the processed image, retake it, or clear it.

The captured frame is drawn into a newly created canvas at a maximum 1280-pixel edge, preserving aspect ratio. Canvas encoding produces a new JPEG rather than copying source EXIF. The encoder tries progressively lower quality levels toward the 1,000,000-byte target, then applies the existing JPEG header, dimensions, metadata, and 2,000,000-byte hard-limit validator.

Active media tracks stop after capture, on error, on camera replacement, and when the component unmounts. JPEG bytes and the object URL remain only in React memory in this slice. Ending the test clears the bytes; component cleanup revokes the URL and stops remaining tracks.

## Evidence

On September 9, 2026:

- eight focused image and setup-preview tests passed;
- landscape, portrait, already-small, and invalid source dimensions behaved as specified;
- the setup schema requires an explicit boolean photo policy;
- the generated setup PDF records `Required` or `Waived by production`;
- TypeScript checks passed across Worker, tests, app, and retained browser spike; and
- the Vite production build passed.

Camera permission, device switching, canvas encoding, visual framing, memory behavior, and track shutdown require manual browser/device verification and are not claimed by the non-browser unit tests.

## Remaining gates

- Test permission approval, denial, retry, retake, clearing, and both waiver branches in a real browser.
- Test at least one phone and one desktop/laptop camera, including narrow-screen layout and device rotation.
- Inspect representative processed byte sizes and confirm canvas-produced JPEGs pass the independent validator.
- Add vector signature capture separately.
- Add the selected photo or explicit waiver to the exact final PDF before any upload is connected.

## Conclusion

The local implementation and testable image-contract logic pass their automated gate without claiming unperformed device-camera evidence. The slice is ready for manual testing.

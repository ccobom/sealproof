# 0008 — Free-plan document and photograph limits

- Date: September 11, 2026
- Status: Accepted for implementation

## Context

SealProof directly Base64-encodes the exact sealed PDF and prepares two separate Resend submissions inside one Cloudflare Worker invocation. The intended Workers Free plan has a nominal 10 ms CPU target. The previous product limits allowed a 3,000,000-byte PDF and a 500,000-byte photograph even though remote measurements showed that these boundaries did not retain dependable CPU margin.

A manually captured, visually approved test release produced a 49,755-byte PDF. Twenty representative 49,755-byte synthetic requests completed successfully, and all nine captured CPU traces used 4-5 ms. At 75,000 bytes, three of six unambiguously mapped requests exceeded 10 ms. At 60,000 bytes, one probe used 7 ms and a subsequent 20-request batch used 3-6 ms, averaging 4.1 ms, with no failures or truncations.

The representative fixture used a 37,948-byte photograph and produced a 46,449-byte PDF. A boundary fixture with a 500,000-byte photograph and maximum-complexity signature produced a 513,473-byte PDF. These measurements show approximately 8,500-13,500 bytes of document overhead in the tested layouts.

## Decision

- The final PDF hard maximum is 60,000 bytes and remains limited to three pages.
- Browser camera encoding targets 35,000 JPEG bytes.
- A signer photograph over 40,000 bytes is rejected.
- Capture begins at a 640-pixel longest edge. If the quality sequence cannot reach the target, the browser retries at 560 and then 480 pixels.
- The browser validates the completed PDF before displaying it for final review, and the Worker independently enforces the exact byte ceiling before reading or sealing an upload.
- The final-PDF and photo-size evidence must be revisited when fonts, layout, agreement length, image presentation, or signature rendering changes.

## Consequences

The 60 KB ceiling has repeated evidence of staying below the nominal Free-plan CPU target and provides approximately 10 KB of headroom above the manually observed release. The lower photo boundary prevents a photograph that is valid by itself from making an operationally unsafe document likely.

Photographs may receive additional JPEG compression or dimension reduction on visually complex frames. The signer still reviews the processed photograph and the exact final PDF before sealing. A frame that remains over 40 KB after the approved attempts fails explicitly rather than being silently omitted. Production's pre-handoff photo waiver remains the only no-photo path.

This evidence applies to the current PDF generator and direct-attachment implementation. It is not a permanent capacity claim for future designs.

## Implementation validation

The completed implementation passed all 206 automated tests and the production build. A fresh local camera walkthrough then produced an approximately 37 KB final PDF. The tester confirmed that both the processed photograph preview and the photograph embedded in the exact final PDF remained clear and sufficiently large for the intended evidence.

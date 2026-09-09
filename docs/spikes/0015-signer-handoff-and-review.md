# 0015 — Signer Handoff and Review

- Date: September 9, 2026
- Result: Pass (local implementation; manual browser test pending)
- Related contract: `docs/product-contract.md`

## Question

Can the deliberately built React application extend its setup preview through an explicit device handoff, meaningful signer review, signer identity fields, date confirmation, and affirmative consent without pretending to capture a photo, signature, or sealed contract?

## Scope

This slice runs entirely in browser memory. It does not use the camera, capture a signature, create a final PDF, upload data, access D1 or R2, send email, or seal a release. The locked agreement remains conspicuous synthetic test text.

## Behavior

1. Production reviews the locally generated setup PDF and explicitly approves the setup.
2. SealProof displays a dedicated instruction to hand the device to the signer.
3. The signer explicitly identifies themself as the current device user.
4. SealProof displays production, collector, email, and project information plus the complete test release.
5. The signer enters their name and email, confirms or corrects the agreement date, and affirmatively checks agreement.
6. Strict runtime validation prevents continuation when an approved field is missing or invalid or consent is absent.
7. The completion screen accurately says that the information remains only in the open browser page and that nothing was signed, stored, emailed, or sealed.
8. Ending the local test clears production and signer state and revokes the generated PDF object URL.

Signer data is not placed in a URL, browser storage, network request, or console log. After production approves handoff, the signer path provides no control for returning to production editing.

## Evidence

On September 9, 2026:

- six focused setup and signer-schema tests passed;
- the strict signer schema accepted only name, email, date, and explicit consent;
- blank names, invalid emails, malformed dates, absent consent, and unapproved future fields were rejected;
- production, test, React application, and retained browser-spike TypeScript checks passed; and
- the Vite production build succeeded with PDF code remaining in lazily loaded chunks.

## Remaining gates

- Complete a manual desktop and narrow-screen browser walkthrough.
- Test keyboard-only navigation, focus movement on validation failure, browser autofill behavior, zoom, and embedded-PDF fallback behavior.
- Add real photo capture and vector signature as separate reviewed slices.
- Generate a new exact final PDF containing approved signer information and evidence, then require final review before any upload.
- Replace synthetic release text only after reviewed language is supplied and approved.

## Conclusion

The explicit handoff and signer-review slice passes its automated local gate without overstating what is implemented. It is ready for manual interaction testing.

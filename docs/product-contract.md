# Product Contract

Status: Draft — delivery and temporary-retention flow approved September 8,
2026; adult/minor role and media-release boundaries approved September 11,
2026; exact legal language and other details remain open.

This document will define the observable behavior of the smallest production release. It should describe what each participant sees and does without prescribing implementation technology.

## Actors

- Production representative
- Adult subject/signer
- Minor subject
- Parent or legal guardian acting as the minor's sole authorizer
- SEALPROOF

## End-to-end behavior

| Step | Actor | Inputs | Observable result | Validation or failure result |
|---|---|---|---|---|
| Start release | Production representative | Production and project information, production email, release text | Signing workflow is prepared | Invalid or missing fields prevent continuation and identify the affected field |
| Handoff | Production representative | Confirmation that setup is complete | Explicit instruction to hand the device to the signer | The signer cannot accidentally edit production setup during the handoff |
| Subject path | Subject | Declaration of whether the subject is 18 or older | Adult subjects continue through the adult path; subjects under 18 continue through the minor/guardian path | No date of birth is collected merely to choose the path; the workflow cannot continue without a path selection |
| Adult review and details | Adult subject/signer | Name, signer email, date, and review of production context and the full release | Adult can proceed to electronic consent and identity evidence | Missing required information prevents continuation and identifies the affected field |
| Adult electronic consent | Adult subject/signer | Separate affirmative acknowledgment of agreement to conduct the release electronically and intent for the drawn signature to sign the reviewed agreement | Adult can proceed to photo and signature | The acknowledgment is not inferred from general use of the interface and cannot be preselected |
| Adult photo and signature | Adult subject/signer | Signer photo when production requires it, plus drawn signature | Adult can finalize the release | A missing required photo, missing signature, or invalid or oversized input prevents finalization; a production-approved photo waiver is shown and recorded rather than treated as missing evidence |
| Minor identity | Minor subject | Minor's name and current identifying photograph | The release identifies the person appearing in the media without asking the minor to authorize it | Missing or invalid required information prevents continuation; no date of birth, minor signature, or minor consent/assent field is collected by default |
| Minor information | Minor subject | Review of a short age-accessible explanation | Minor is told what is happening, which media permission production requests, that the guardian makes the authorization decision, and that the minor can ask questions or voice concerns to production | Continuing means only that the device is ready to be handed to the guardian; it is not consent, assent, signature, authorization, or evidence of any of those things |
| Guardian handoff and review | Minor subject and production representative, then parent/legal guardian | Explicit device handoff followed by production context and full-release review | Guardian receives the device without the minor's interaction being treated as authorization | Guardian cannot silently inherit a completed consent or signature from the minor step |
| Guardian details and authority representation | Parent/legal guardian | Name, relationship to minor, email, and explicit representation that they are the minor's parent/legal guardian and authorized to consent | Guardian can proceed to electronic consent and signature | Missing representation or required information prevents continuation; SealProof records the representation but does not independently verify identity, parentage, guardianship, or authority |
| Guardian electronic consent and signature | Parent/legal guardian | Separate affirmative electronic-consent and intent-to-sign acknowledgment, plus guardian signature | Guardian can finalize on behalf of the minor | No guardian photograph or minor signature is collected by default; missing acknowledgment or guardian signature prevents continuation |
| Finalize | SEALPROOF | Approved release data, photo, and signature | Progress indicator advances through actual completed stages | A failure produces an accurate failure state rather than a false success |
| Seal | SEALPROOF | Final PDF bytes | PDF is hashed and the hash is verified against the same bytes | The release is not called sealed if PDF generation or hash verification fails |
| Await delivery | SEALPROOF | The exact sealed PDF submitted separately for production and the adult signer or guardian | **THE CONTRACT IS SEALED** screen displays both delivery states as pending | Provider rejection moves the affected delivery to failed; a delay remains pending |
| Delivered | Resend and SEALPROOF | Authenticated delivery webhooks for both messages | Screen reports that both recipient mail servers accepted their messages and tells the signer to return the device | One successful delivery does not make the overall delivery state successful |
| Delivery failed | SEALPROOF | Permanent failure for one or both messages | Screen identifies the failed role, displays the bounded retries remaining, and offers eligible retry plus separate download and closeout actions | Retry sends only failed recipients the exact stored PDF; closeout makes retry unavailable |
| Production closeout | Production representative | Device returned after delivery | One final local-download opportunity and an explicit exit-and-delete action | The interface warns that the server copy and retry capability will be removed |
| End release | SEALPROOF | Explicit exit or automatic expiry | Temporary PDF is deleted and access to the release is invalidated | Cleanup failure is recorded without retaining personal information in the audit error |

## State definitions

```text
CREATING
→ SIGNING
→ FINALIZING
→ SEALED_AWAITING_DELIVERY
→ DELIVERED
  or
→ DELIVERY_FAILED
  or
→ DELIVERY_UNRESOLVED
→ CLOSED
```

- **Sealed** means the final PDF bytes exist, their SHA-256 hash has been calculated, and recalculating the hash over those same bytes produced the same value.
- **Sent** means Resend accepted an email API request and will attempt delivery.
- **Delivered** means the recipient's mail server accepted the message. It does not mean the person opened or read it.
- Overall delivery is **delivered** only when both the production and signer messages are delivered.
- A delivery delay remains pending. A permanent provider failure or bounce is failed for the affected recipient role.
- Each recipient role may have at most two retries after its original attempt. Retries never extend the original two-hour expiry or regenerate the sealed PDF.
- If one delivery attempt receives contradictory terminal events, its status and the overall release become **delivery unresolved**. SEALPROOF does not claim success or failure when the provider evidence conflicts.

## Adult and minor role rules

- An adult subject is the signer and subject-side delivery recipient.
- For a minor subject, the parent/legal guardian is the sole legal authorizer
  and subject-side delivery recipient in the SealProof workflow.
- The minor is a participant and the person depicted, but does not sign or
  provide consent or assent by default.
- The minor-information step exists to provide age-accessible information and
  a deliberate opportunity to ask questions or voice concerns. Its button
  records no consent, assent, legal authorization, or audit evidence.
- SealProof collects one current identifying photograph of the minor. It does
  not collect a guardian photograph, minor signature, or date of birth by
  default.
- SealProof records the guardian's stated relationship and representation of
  authority. It does not claim to verify the guardian's identity, parentage,
  legal status, or authority.
- Specialist legal review of the completed workflow, wording, PDF, and product
  claims is required before public launch, but is not a blocker to implementing
  this approved MVP behavior.

## Built-in agreement boundary

- The built-in agreement documents only the media-use permissions stated in
  the release concerning the subject's image, voice, likeness, appearance, and
  related media.
- It is not an employment, hiring, performer-services, compensation, or
  payment agreement and must never be presented as one.
- Production and the adult signer or guardian receive a clear explanation of
  that boundary before signature.
- Any promised payment or other compensation must be documented separately.
- The built-in boilerplate, generated PDF, participant screens, and public
  marketing claims must remain within this declared lane.
- SealProof does not claim that the release proves identity, age, guardian
  authority, understanding, legal validity, or guaranteed enforceability.

## Progress indicator

The interface displays a small progress indicator across the workflow. It advances only when real stages are completed:

```text
Production details → Review → Sign → Seal → Deliver → Close
```

It may animate while waiting, but it must not claim that an incomplete stage has finished.

## Retry, download, and deletion

- Production and the adult signer or guardian receive separate messages created from the exact same stored PDF bytes.
- Retry resends only a failed recipient's message and reuses those bytes; it does not regenerate the document.
- **Download** and **Delete/Close** are separate controls. Downloading creates a local production-side copy but does not deliver it to the signer/guardian, delete SealProof storage, or close the release.
- **Delete/Close** deletes SealProof's temporary copy, closes the release, and makes download and retry unavailable. The interface warns production before this action.
- After subject-side delivery failure, the interface must not imply that a production-device download itself gives the signer/guardian a copy. It calmly explains that the contract remains sealed and production must arrange another delivery method before closeout if the signer/guardian still needs a copy.
- Explicit production closeout deletes the temporary PDF immediately.
- If nobody closes the release, SealProof disables access at exactly two hours and submits the temporary PDF and PII to an every-minute deletion sweep that retries until absence is confirmed.
- The two-hour expiry always wins over delivery state. At expiry, SealProof disables download and retry immediately; scheduled cleanup deletes temporary data, closes the release, and records delivery as unresolved if neither success nor permanent failure was confirmed.
- A delivery with contradictory terminal events is not retried automatically because the original message may have arrived. The interface reports that delivery could not be confirmed and preserves the separate download and closeout controls during the unchanged two-hour window.
- Deleting SealProof's copy does not control any copy already processed or retained by the email provider.

## Final document limits

- The finalized PDF may contain no more than three pages.
- The finalized PDF may contain no more than 60,000 bytes.
- The reviewed browser generator enforces both limits before signature collection and displays the exact generated PDF for signer review.
- The Worker independently enforces the 60,000-byte limit, checks the PDF header, hashes the exact uploaded bytes, and uses R2 checksum validation before sealing. It does not fully parse the document because remote testing showed that parsing and preparing larger inputs does not retain dependable margin within the intended Free-plan CPU budget.
- The three-page rule is a constraint of SealProof's generator and review flow, not a claim that the Worker can prove the page count of bytes submitted by a modified or hostile client.
- A document outside either limit is not sealed and produces a clear correction path rather than silently truncating agreement text, images, or signatures.

## Optional photograph

- Production decides during setup whether a current signer photograph is required; the default is required.
- The choice is fixed before device handoff, displayed to the signer, and recorded in the generated PDF.
- If required, camera denial or failure cannot be silently bypassed.
- If waived by production, the signer may take a photo or explicitly continue without one.
- Gallery or file upload is not treated as equivalent to taking a current signer photograph.
- The browser capture path begins at a maximum 640-pixel longest edge and targets 35,000 encoded JPEG bytes. It tries lower JPEG qualities and then progressively smaller 560- and 480-pixel longest edges rather than immediately failing a complex camera frame. It rejects a photograph over the 40,000-byte hard limit.
- The evidence-page photograph preserves its aspect ratio and fits within a 175-by-175-point area so it supports identity evidence without dominating the agreement.
- The production-controlled optional-photo rule applies to the adult path. The
  approved minor path requires one current identifying photograph of the minor
  and does not request a guardian photograph by default.

## Explicitly outside the first release

- Employment, hiring, performer-services, compensation, and payment
  agreements or guarantees.
- Independent verification of identity, age, parentage, guardianship, legal
  authority, contractual capacity, or the truth of participant statements.
- Guardian photography and minor signatures by default.
- Treating the minor-information interaction as consent, assent, signature,
  authorization, or evidence.
- Reusable QR production presets and custom reusable agreement storage.
- Longitudinal signer analytics.

## Open decisions

- Exact production fields and whether any custom agreement text is supported
  in the first release; custom agreements are not assumed equivalent to the
  built-in media-use release.
- Exact adult and guardian electronic-consent, authority-representation,
  limitation, and built-in release language, pending specialist review before
  public launch.
- User-facing disclosure of Resend's processing and retention.
- Exact wording and confirmation behavior for the separate Download and
  Delete/Close controls.
- Accessibility requirements for live delivery-status updates and the progress indicator.

## Approval record

- Approved by: Project owner
- Date: September 8, 2026
- Notes: State meanings, delivery flow, retry choices, explicit deletion, an unconditional two-hour access window followed by recurring verified deletion, and a three-page limit are approved. The original 3,000,000-byte document limit was replaced on September 11 by the evidence-backed 60,000-byte operational limit. The document remains a draft until its open decisions are resolved.
- September 11, 2026: A 60,000-byte final-PDF ceiling, 35,000-byte photo target, 40,000-byte photo hard limit, and adaptive 640/560/480-pixel capture sequence were approved after remote CPU testing.
- September 9, 2026: Production-controlled optional signer photography was approved. Photography defaults to required; a waiver must be chosen before handoff, shown to the signer, and recorded in the document.
- September 11, 2026: Minor/guardian support was approved as an MVP
  implementation direction. The minor provides name and one current
  identifying photograph, receives a legally neutral informational step, and
  hands the device to the parent/legal guardian. The guardian provides the
  representation of authority, electronic-consent acknowledgment, and sole
  signature; no guardian photograph or minor signature is collected by
  default. Specialist review remains required before public launch but does not
  block development.
- September 11, 2026: The built-in agreement was limited to media-use
  permissions and expressly excluded employment, hiring, performer services,
  compensation, and payment documentation or guarantees.

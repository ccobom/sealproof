# Product Contract

Status: Draft — delivery and temporary-retention flow approved September 8, 2026; other details remain open.

This document will define the observable behavior of the smallest production release. It should describe what each participant sees and does without prescribing implementation technology.

## Actors

- Production representative
- Signer
- SEALPROOF

## End-to-end behavior

| Step | Actor | Inputs | Observable result | Validation or failure result |
|---|---|---|---|---|
| Start release | Production representative | Production and project information, production email, release text | Signing workflow is prepared | Invalid or missing fields prevent continuation and identify the affected field |
| Handoff | Production representative | Confirmation that setup is complete | Explicit instruction to hand the device to the signer | The signer cannot accidentally edit production setup during the handoff |
| Review and consent | Signer | Name, signer email, date, explicit agreement | Signer can proceed to identity evidence and signature | Missing consent or required information prevents continuation |
| Photo and signature | Signer | Signer photo when production requires it, plus drawn signature | Signer can finalize the release | A missing required photo, missing signature, or invalid or oversized input prevents finalization; a production-approved photo waiver is shown and recorded rather than treated as missing evidence |
| Finalize | SEALPROOF | Approved release data, photo, and signature | Progress indicator advances through actual completed stages | A failure produces an accurate failure state rather than a false success |
| Seal | SEALPROOF | Final PDF bytes | PDF is hashed and the hash is verified against the same bytes | The release is not called sealed if PDF generation or hash verification fails |
| Await delivery | SEALPROOF | The exact sealed PDF submitted separately for production and signer | **THE CONTRACT IS SEALED** screen displays both delivery states as pending | Provider rejection moves the affected delivery to failed; a delay remains pending |
| Delivered | Resend and SEALPROOF | Authenticated delivery webhooks for both messages | Screen reports that both recipient mail servers accepted their messages and tells the signer to return the device | One successful delivery does not make the overall delivery state successful |
| Delivery failed | SEALPROOF | Permanent failure for one or both messages | Screen identifies the failed role and offers retry or download-and-delete | Retry sends only failed recipients the exact stored PDF; deletion makes retry unavailable |
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
- If one delivery attempt receives contradictory terminal events, its status and the overall release become **delivery unresolved**. SEALPROOF does not claim success or failure when the provider evidence conflicts.

## Progress indicator

The interface displays a small progress indicator across the workflow. It advances only when real stages are completed:

```text
Production details → Review → Sign → Seal → Deliver → Close
```

It may animate while waiting, but it must not claim that an incomplete stage has finished.

## Retry and deletion

- Production and signer receive separate messages created from the exact same stored PDF bytes.
- Retry resends only a failed recipient's message and reuses those bytes; it does not regenerate the document.
- **Download and delete** downloads a local copy, deletes SealProof's temporary copy, closes the release, and makes retry impossible.
- Explicit production closeout deletes the temporary PDF immediately.
- If nobody closes the release, SealProof disables access at exactly two hours and submits the temporary PDF and PII to an every-minute deletion sweep that retries until absence is confirmed.
- The two-hour expiry always wins over delivery state. At expiry, SealProof disables download and retry immediately; scheduled cleanup deletes temporary data, closes the release, and records delivery as unresolved if neither success nor permanent failure was confirmed.
- A delivery with contradictory terminal events is not retried automatically because the original message may have arrived. The interface reports that delivery could not be confirmed and offers download-and-delete during the unchanged two-hour window.
- Deleting SealProof's copy does not control any copy already processed or retained by the email provider.

## Final document limits

- The finalized PDF may contain no more than three pages.
- The finalized PDF may contain no more than 3,000,000 bytes.
- The reviewed browser generator enforces both limits before signature collection and displays the exact generated PDF for signer review.
- The Worker independently enforces the 3,000,000-byte limit, checks the PDF header, hashes the exact uploaded bytes, and uses R2 checksum validation before sealing. It does not fully parse the document because the representative remote test exceeded the intended Free-plan CPU budget.
- The three-page rule is a constraint of SealProof's generator and review flow, not a claim that the Worker can prove the page count of bytes submitted by a modified or hostile client.
- A document outside either limit is not sealed and produces a clear correction path rather than silently truncating agreement text, images, or signatures.

## Optional photograph

- Production decides during setup whether a current signer photograph is required; the default is required.
- The choice is fixed before device handoff, displayed to the signer, and recorded in the generated PDF.
- If required, camera denial or failure cannot be silently bypassed.
- If waived by production, the signer may take a photo or explicitly continue without one.
- Gallery or file upload is not treated as equivalent to taking a current signer photograph.

## Explicitly outside the first release

To be decided. Candidate exclusions must be approved before implementation.

## Open decisions

- Exact production fields and whether custom agreement text is supported in the first release.
- User-facing disclosure of Resend's processing and retention.
- Exact language and confirmation behavior for download-and-delete.
- Accessibility requirements for live delivery-status updates and the progress indicator.

## Approval record

- Approved by: Project owner
- Date: September 8, 2026
- Notes: State meanings, delivery flow, retry choices, explicit deletion, an unconditional two-hour access window followed by recurring verified deletion, and final-document limits of three pages and 3,000,000 bytes are approved. The document remains a draft until its open decisions are resolved.
- September 9, 2026: Production-controlled optional signer photography was approved. Photography defaults to required; a waiver must be chosen before handoff, shown to the signer, and recorded in the document.

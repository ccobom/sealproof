# Data Lifecycle

Status: Draft — exact two-hour access expiry and recurring verified deletion approved September 9, 2026; provider retention and remaining data details are open.

Every item of data used by SEALPROOF should have an explicit lifecycle before the production architecture is selected.

| Datum | Created by | Exists in browser | Transmitted to | Stored where | Retention | Deletion trigger | Evidence of deletion |
|---|---|---|---|---|---|---|---|
| Production name and project information | Production representative | During active release | SEALPROOF backend; included in PDF | Temporary release state; exact location open | Access ends at two hours; deletion sweeps retry until confirmed | Explicit closeout or automatic expiry | Cleanup completion timestamp; no value retained |
| Production email | Production representative | During active release | SEALPROOF backend and Resend | Temporary release state; Resend processing is external | SealProof access ends at two hours; deletion sweeps retry until confirmed; Resend retention requires disclosure | Explicit closeout or automatic expiry | Cleanup completion timestamp; no address retained in audit |
| Agreement text | Production representative | During review and signing | SEALPROOF backend; included in PDF | Temporary release state; exact location open | Access ends at two hours; deletion sweeps retry until confirmed | Explicit closeout or automatic expiry | Cleanup completion timestamp; no agreement text retained |
| Signer name and date | Signer | During active release | SEALPROOF backend; included in PDF | Temporary release state; exact location open | Access ends at two hours; deletion sweeps retry until confirmed | Explicit closeout or automatic expiry | Cleanup completion timestamp; no values retained |
| Signer email | Signer | During active release | SEALPROOF backend and Resend | Temporary release state; Resend processing is external | SealProof access ends at two hours; deletion sweeps retry until confirmed; Resend retention requires disclosure | Explicit closeout or automatic expiry | Cleanup completion timestamp; no address retained in audit |
| Signer photo | Signer device | During active release | SEALPROOF backend; embedded in PDF | Temporary release state and final PDF only | Access ends at two hours; deletion sweeps retry until confirmed | Explicit closeout or automatic expiry | Cleanup completion timestamp; no image retained |
| Signature | Signer device | During active release | SEALPROOF backend; embedded in PDF | Temporary release state and final PDF only | Access ends at two hours; deletion sweeps retry until confirmed | Explicit closeout or automatic expiry | Cleanup completion timestamp; no signature retained |
| Finalized PDF | SEALPROOF | Available for immediate authorized download | Resend, separately for production and signer | Application-encrypted ciphertext in private R2; wrapped per-release key in temporary D1 state | Access ends at two hours; deletion sweeps retry until confirmed | Download-and-delete, production closeout, or automatic expiry | Cleanup completion timestamp plus retained plaintext document hash |
| Document hash | SEALPROOF | May be displayed in result | Included in approved transaction information | Minimal audit record | One year after cleanup | Automatic audit expiry | Successful idempotent deletion; no replacement transaction-level record |
| Transaction ID | SEALPROOF | Displayed during result | Included in approved transaction information | Minimal audit record | One year after cleanup | Automatic audit expiry | Successful idempotent deletion; no replacement transaction-level record |
| Resend message IDs and role-specific status | Resend | Displayed as role-level status without address | Resend webhook to SEALPROOF | Provider IDs: until cleanup; final role outcomes: one year after cleanup | Cleanup removes provider IDs; automatic audit expiry removes outcomes | Cleanup and audit-deletion operations succeed without retaining provider IDs |
| Delivery attachment plaintext | SEALPROOF and Resend | Supplies the exact sealed PDF to each recipient message | Resend receives Base64 attachment content during its authenticated API request | Mutable Worker ciphertext and plaintext buffers are overwritten after submission; JavaScript strings are transient but cannot be explicitly overwritten | Resend retains sent message content under its own service policy; SealProof retains only the encrypted R2 copy until closeout or two-hour expiry | Encrypted R2 copy is deleted at closeout or expiry | No public attachment URL or usable provider bearer is created |
| Cleanup completion timestamp | SEALPROOF | Not required | None | Minimal audit record | One year after cleanup | Automatic audit expiry | Successful idempotent deletion; no replacement transaction-level record |

## Lifecycle events

Define what happens when:

- a draft is abandoned;
- finalization succeeds;
- document generation fails;
- one or both email submissions fail;
- an email is accepted but later bounces;
- cleanup fails;
- a signing link expires.

## Approved temporary-retention rule

- SealProof may retain the exact finalized PDF only to confirm delivery, permit retry with identical bytes, and offer the approved local-download paths.
- Explicit download-and-delete or production closeout deletes the temporary PDF immediately and invalidates retry.
- Automatic expiry invalidates all temporary access exactly two hours after finalization and submits the temporary PDF and PII to the recurring deletion sweep, even if delivery remains pending or the browser is closed.
- Automatic expiry takes precedence over every delivery state. Pending or delayed delivery cannot extend retention.
- At expiry, SealProof invalidates download and retry capabilities. The scheduled sweep deletes the temporary PDF and PII, closes the release, and records `expired_delivery_unresolved` when no final delivery outcome was received.
- Automatic cleanup is a safety net, not a reason to delay explicit deletion.
- This rule governs storage controlled by SealProof. Resend's processing and retention are external and must be disclosed separately.

## Open lifecycle decisions

- Where pre-finalization PII and the finalized PDF reside during the two-hour window.
- Operational rotation and recovery procedures for temporary PDF key-encryption keys.
- Resend attachment and message retention, deletion controls, and final disclosure language.
- Operational alerting behavior if repeated explicit or automatic cleanup fails.

## Approval record

- Approved by: Project owner
- Date: September 8, 2026
- Notes: Explicit deletion, exact two-hour access expiry followed by recurring verified deletion of SealProof-controlled temporary PDF and PII, and automatic deletion of minimal audit records one year after cleanup are approved. Other open lifecycle decisions remain unapproved.

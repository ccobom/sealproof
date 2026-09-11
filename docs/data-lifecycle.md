# Data Lifecycle

Status: Draft — current adult test implementation and approved minor/guardian
MVP direction reconciled September 11, 2026. Exact two-hour access expiry,
verified cleanup, and one-year minimal-audit expiry remain approved. Provider
retention, key operations, and final disclosures remain open.

## Scope and status

This document describes where each datum exists, who receives it, and when
SealProof-controlled copies become inaccessible and are deleted. Rows marked
**Implemented** describe the controlled adult test application. Rows marked
**Approved direction** describe the minor/guardian MVP before implementation.

Browser memory, SealProof-controlled Cloudflare storage, Resend, and recipient
mail systems are separate retention domains. Deleting one does not delete the
others.

## Browser and document data

| Datum | Path and status | Browser lifecycle | Sent to SealProof | External disclosure | After closeout |
|---|---|---|---|---|---|
| Production name, collector name, project, agreement date, and intended-use context | Adult and minor paths; implemented core | Held in volatile page state and embedded in generated previews/final PDF; not intentionally written to local or session storage | Only inside the finalized PDF bytes | Included in each Resend attachment | Cleared when the user resets the page, reloads/navigates away, or closes the page; an explicitly downloaded file remains under production's control |
| Built-in agreement text and version | Adult and minor paths; text implemented, explicit template version pending | Held/rendered for review and embedded in the PDF | Only inside the finalized PDF; workflow version is separately sent | Included in each attachment | Same browser/PDF behavior as above; versioning retained only as described under audit data |
| Adult subject name and signed date | Adult; implemented | Volatile page state and finalized PDF | Only inside the finalized PDF | Included in each attachment | No structured server copy exists; downloaded and emailed PDFs remain outside SealProof-controlled cleanup |
| Adult subject photo or recorded production waiver | Adult; implemented | Captured/encoded in memory and embedded in the finalized PDF | Only inside the finalized PDF | Included in each attachment | No separate server image object exists; browser state clears separately from server closeout |
| Adult electronic-consent and intent-to-sign acknowledgment | Adult; approved direction | Intended to be held in page state and rendered into the exact reviewed PDF | Intended only inside the PDF; an approved non-PII process flag may later be added to audit | Included in each attachment | Exact flag schema and retention require a reviewed migration before implementation |
| Adult signature | Adult; implemented | Vector input exists in page memory and is drawn into the finalized PDF | Only inside the finalized PDF | Included in each attachment | No separate server signature object exists |
| Adult signer email | Adult; implemented | Volatile page state and encrypted five-minute finalization ticket | Sent to the Worker during admission/finalization; then application-encrypted in temporary D1 | Decrypted transiently for separate Resend submission; processed and retained independently by Resend/mail systems | Removed from temporary D1 during successful closeout/expiry cleanup; no address is retained in audit |
| Adult/minor path selection | Both; approved direction | Intended volatile page state and PDF content | Intended inside the PDF; a bounded non-PII workflow flag is proposed | Included in attachment if rendered in the PDF | No person-level path value may be retained beyond approved audit flags |
| Minor name | Minor; approved direction | Intended volatile page state and finalized PDF | Intended only inside the finalized PDF | Included in production and guardian attachments | No separate structured server field or audit value |
| Minor identifying photo | Minor; approved direction | Intended captured/encoded memory and finalized PDF | Intended only inside the finalized PDF | Included in production and guardian attachments | No separate image object or audit value; size budget must be revalidated with the completed minor PDF |
| Minor-information screen interaction | Minor; approved direction | Screen state only | **Not sent or retained as consent, assent, authorization, signature, or evidence; no audit flag by default** | None except any general interface request metadata outside application records | Disappears with page reset/navigation/close |
| Guardian name, relationship, and representation of authority | Minor; approved direction | Intended volatile page state and finalized PDF | Intended only inside the finalized PDF | Included in production and guardian attachments | No structured audit values; SealProof does not verify or separately retain the representation |
| Guardian electronic-consent and intent-to-sign acknowledgment | Minor; approved direction | Intended page state and exact reviewed PDF | Intended inside the PDF; a bounded non-PII process flag may later be approved | Included in each attachment | Exact audit flag schema remains unimplemented |
| Guardian signature | Minor; approved direction | Intended vector input in page memory and finalized PDF | Intended only inside the finalized PDF | Included in each attachment | No separate signature object or audit value |
| Guardian email | Minor; approved direction | Intended to occupy the existing subject-side email role in page state and the encrypted finalization ticket | Intended to replace the adult signer address in the same encrypted temporary envelope | Decrypted transiently for the guardian's Resend submission | Removed during cleanup; no address retained in audit |

## Data deliberately not collected by default

The MVP must not add these fields merely because the minor workflow exists:

- minor date of birth or exact age;
- minor signature, consent, assent, or authorization record;
- evidence that the minor pressed the informational handoff button;
- guardian photograph;
- identity documents;
- proof of parentage, court guardianship, or legal authority; or
- employment, services, compensation, or payment terms.

Any future proposal to collect one requires an explicit purpose, product-owner
approval, legal/privacy review, lifecycle update, threat-model update, and
retention/deletion tests before implementation.

## Finalization and capability data

| Datum | Created/transmitted | SealProof storage | Retention and deletion |
|---|---|---|---|
| Turnstile response token | Browser sends it to the Worker; Worker sends bounded verification data to Cloudflare Siteverify | Not intentionally stored in D1 or R2 | Used for admission only; Cloudflare processing is external and requires disclosure appropriate to the deployed service |
| Finalization ticket | Worker returns an AES-GCM-encrypted ticket containing admission ID, both role emails, document hash, workflow version, issue time, and expiry | Held by the browser; not stored as a reusable server secret | Expires five minutes after issue; a consumed admission marker is temporary and cascades with release cleanup |
| Finalized PDF plaintext | Browser sends the exact reviewed bytes; Worker hashes and transiently encrypts/decrypts them for storage and delivery | Never intentionally stored as plaintext in D1 or R2 | Browser memory persists until explicit browser clearing/reset or page termination; Worker buffers/strings are transient runtime data and cannot all be explicitly overwritten |
| Encrypted finalized PDF | Worker application-encrypts the PDF with a per-document key | Ciphertext in private R2; wrapped data key, IVs, versions, sizes, hashes, and private object key in temporary D1 | Accessible only before the exact two-hour authorization deadline; deleted and absence-checked during explicit or scheduled cleanup |
| Production and subject-side email envelope | Browser supplies addresses through the encrypted ticket; Worker re-encrypts them using a per-release data key | AES-GCM ciphertext plus wrapped data key and metadata in temporary D1 | Decrypted only for delivery submission; deleted with temporary release state at closeout/expiry |
| Status and download capabilities | Worker generates random capabilities; browser receives plaintext values | Only SHA-256 capability hashes are stored in temporary D1 | Authorization fails at the exact two-hour boundary or after cleanup starts; hashes are deleted with temporary state |
| R2 object key | Worker generates a private key | Temporary D1 | Deleted with temporary state after R2 deletion is confirmed; never exposed as a public attachment URL |

## Delivery data

| Datum | SealProof behavior | Temporary retention | External retention |
|---|---|---|---|
| Direct attachment content | Worker decrypts the exact PDF, Base64-encodes it, and submits separate production and subject-side Resend requests | No second attachment object is stored; transient mutable byte buffers are overwritten where possible, while JavaScript strings cannot be explicitly zeroed | Resend and recipient mail systems process and may retain message content independently |
| Delivery attempt | Role, immutable attempt number, bounded state, timestamps, and provider message ID | Temporary D1 only; at most three attempts per role including the original | Resend maintains its own message/event records under its policies |
| Submission failure diagnostic | Bounded category and timestamp; no raw provider body or address | Temporary D1 | Provider may retain fuller diagnostic data independently |
| Webhook receipt | Svix ID, payload hash, transaction/attempt link, approved event type, and receipt time | Temporary D1 for replay protection and state transitions | Resend/Svix handling is external |
| Role-level outcome | Production and subject-side outcomes are independently computed | Current outcome is in audit D1; detailed attempts disappear at cleanup | Recipient and provider copies are unaffected by SealProof cleanup |

## Minimal audit record

The currently implemented audit table retains:

- random transaction ID;
- plaintext SHA-256 document hash and algorithm;
- workflow version;
- server finalization timestamp;
- bounded release state;
- production and subject-side delivery outcomes;
- bounded failure and closeout categories;
- bounded cleanup failure information and timestamps;
- cleanup completion timestamp; and
- audit-expiry timestamp.

It does not retain names, email addresses, photographs, signatures, agreement
text, provider message IDs, storage keys, encryption envelopes, raw webhook
payloads, or usable capabilities after temporary cleanup.

Proposed template-version and electronic-consent/photo/signature process flags
are not yet implemented. Before adding them, define exact bounded values,
justify their evidentiary purpose, verify that they do not encode PII, migrate
the schema explicitly, and update cleanup/audit-expiry tests.

After cleanup completes, the audit record expires one year later. Scheduled
maintenance deletes it without creating a replacement transaction-level
record. “Minimal” does not mean permanent.

## Lifecycle events

### Draft abandoned before admission

Structured inputs and generated previews exist only in the browser page. No
application D1 or R2 release exists. Reset, navigation, reload, or closing the
page releases application references; browser/runtime behavior controls final
memory reclamation.

### Document generation or review fails

SealProof does not call the document sealed. Inputs remain in the browser so
the user can correct or clear them. No finalized PDF is uploaded.

### Admission issued but finalization not completed

The encrypted browser-held ticket becomes unusable after five minutes. No
release PDF or temporary D1 release state exists unless finalization consumes
the ticket successfully. Turnstile and ordinary infrastructure request records
remain governed by their providers and operational configuration.

### Finalization succeeds

The Worker independently matches the browser hash, stores only encrypted PDF
bytes in private R2, creates encrypted temporary address state and delivery
attempts in D1, and begins separate role deliveries. The two-hour expiry is
calculated from server finalization time and is never extended by delivery,
delay, failure, or retry.

### Submission fails, delivery is delayed, or a message bounces

Only the affected role changes state. The exact encrypted PDF and temporary
address envelope remain available until closeout or the original expiry for
bounded retry and authorized download. A successful role is not resent when
the other role retries. Contradictory terminal events become unresolved rather
than false success or failure.

### Explicit closeout

Downloading and closing are separate. Download creates a production-controlled
browser/file-system copy and does not itself delete or deliver anything.
Delete/Close invalidates access, deletes the encrypted R2 object, confirms its
absence, removes temporary D1 state by cascade, and marks minimal audit cleanup
complete. It cannot delete downloaded files, Resend data, or mailbox copies.

### Automatic expiry and scheduled cleanup

Status, retry, and download authorization fail at exactly two hours even if no
scheduled job has run. Physical deletion begins on the next successful
scheduled sweep, verifies R2 absence, deletes temporary D1 state, and retries
on later sweeps after bounded cleanup failure.

The local, test, and production configurations run this sweep every minute.
Cloudflare may delay scheduled execution, so SealProof claims exact access
expiry but not exact-millisecond physical deletion by distributed
infrastructure.

### Audit expiry

Once cleanup completes, the independent one-year deadline begins. Scheduled
maintenance deletes due minimal audit rows in bounded batches.

## Current versus future data domains

The present MVP lifecycle excludes:

- remote-guardian continuation links, QR payloads, and incomplete-transaction
  state beyond the shared-device flow;
- reusable production presets and preset QR codes;
- custom reusable agreement storage;
- preset analytics;
- email-derived or browser/device longitudinal free-user analytics; and
- all longitudinal signer analytics.

Those future concepts must not be added to current tables opportunistically.
If approved later, audit, optional free-user analytics, and preset analytics
may begin as logically separated tables and code paths in one database without
a convenient shared person-level identity key. Each requires its own purpose,
access boundary, retention, deletion, and threat analysis.

## Open lifecycle decisions

- Final Resend and recipient-provider processing/retention disclosures.
- Operational rotation, retirement, loss, and recovery procedures for PDF and
  email key-encryption keys without extending PII retention.
- Privacy-preserving alerts and escalation after repeated cleanup failure.
- Exact bounded audit flags for electronic consent, applicable signer role,
  photo completion/waiver, and built-in template version.
- Browser wording and behavior that makes clearing remaining in-page PDF/source
  data understandable after server closeout.
- Any lifecycle corrections required by specialist legal review.

## Approval record

- Approved by: Project owner
- Date: September 8, 2026
- Notes: Explicit deletion, exact two-hour access expiry followed by recurring
  verified deletion of SealProof-controlled temporary PDF and PII, and
  automatic deletion of minimal audit records one year after cleanup are
  approved.
- September 11, 2026: Adult/minor branching, minor name and identifying photo,
  guardian role/email/representation/electronic consent/signature, the
  informational-only minor screen, and the fields deliberately not collected
  were added as approved MVP direction. Their implementation and final legal
  language remain incomplete.

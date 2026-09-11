# Pre-Launch Legal Review Questions

Status: Review brief — not legal advice and not a development specification.

## Purpose

This file preserves questions for qualified specialist counsel to review after
SealProof's adult and minor/guardian MVP workflows, built-in boilerplate,
warnings, and product claims can be evaluated together. These questions do not
authorize new data collection, identity verification, or product features.
They are not development blockers unless the project owner expressly changes
that direction or counsel identifies a required correction before public
launch.

## Declared product boundary

SealProof's built-in agreement is intended exclusively to document permission
to use a subject's image, voice, likeness, appearance, and related media. It is
not intended to document or guarantee employment, hiring, performer services,
compensation, or payment. Any promised payment must be documented separately.

SealProof records representations and workflow evidence. It does not verify a
person's identity, age, parentage, guardianship, authority, contractual
capacity, or the truth of information entered by participants.

## Status terms used in this brief

| Status | Meaning |
|---|---|
| Implemented | Present in the current controlled test application |
| Approved direction | Approved for MVP implementation but not yet complete |
| Proposed wording | Intent is approved; exact language still requires drafting and review |
| Current policy | Documented system rule, subject to confirmation in the completed product |

## Current responses to legal and product concerns

These measures are SealProof's present attempts to address known concerns. The
limitations are recorded so their inclusion is not mistaken for a claim that
the concern has been legally resolved.

| Concern | Current or intended measure | Status | Known limitation and question for counsel |
|---|---|---|---|
| Agreement to transact electronically | Present a separate affirmative acknowledgment before signature stating that the adult agrees to conduct the release electronically | Approved direction; exact language proposed | Does the placement, optionality, and wording adequately establish agreement to use the electronic process for every intended transaction? |
| Intent to sign | Require an affirmative statement that the adult intends the drawn signature to sign the agreement, followed by signature capture | Approved direction; drawing capture implemented | Does this sequence sufficiently connect intent, signature, signer, and the exact reviewed record without overstating identity verification? |
| Opportunity to review | Generate the exact final PDF in the browser and display it before consent and finalization | Implemented | Is the display and fallback behavior adequate for meaningful review, accessibility, printing, and retention requirements? |
| Integrity of the signed record | Hash the exact reviewed PDF in the browser, independently match it in the Worker, retain the SHA-256 and transaction ID, and send the same sealed bytes to each recipient | Implemented and live-tested | Is this evidence described accurately, and should any additional attribution or record evidence be retained? A matching hash proves byte identity, not identity, authority, understanding, or enforceability. |
| Accurate delivery claims | Track production and signer/guardian messages separately; reserve `DELIVERED` for authenticated provider evidence that the recipient mail server accepted the message | Implemented and live-tested | Is mail-server acceptance enough for the product's record-delivery obligations, and is the interface sufficiently clear that it does not prove opening or reading? |
| Delivery failure | Preserve the exact sealed PDF temporarily, permit bounded role-specific retry, offer production download, and report failure without claiming successful delivery | Implemented and live-tested for a controlled bounce | What notice or alternative delivery procedure is legally required when the signer/guardian copy fails, is mistyped, or cannot be emailed? |
| Participant access to a copy | Submit separate exact-PDF messages to production and the adult signer/guardian | Adult flow implemented; guardian routing approved direction | Must the signer/guardian be offered a nonelectronic option, and who must receive copies in the minor flow? |
| Guardian authority | Collect the adult's parent/legal-guardian relationship and explicit representation that they are authorized to consent for the minor | Approved direction; exact language proposed | Is the representation sufficient for supported uses, must parent and court-appointed guardian paths differ, and which uses should SealProof decline without more evidence? |
| Avoiding false verification claims | State that SealProof records the guardian's representation but does not verify identity, parentage, guardianship, or authority | Approved product boundary; exact wording proposed | Is the limitation prominent and precise without undermining necessary representations or misleading production about what the record establishes? |
| Data minimization in the minor flow | Collect one identifying photo of the minor; do not collect the guardian's photo, the minor's signature, or date of birth by default | Approved direction | Is the minor photo proportionate and lawful for the intended purpose, and do any supported uses require different age, identity, notice, or consent evidence? |
| Minor's awareness and agency | Before guardian handoff, show an age-accessible explanation of what is happening, the requested media permission, the guardian's role, and the minor's ability to ask questions or voice concerns | Approved ethical/UX direction | Does expressly labeling this as informational preserve its intended legal neutrality? Should any wording be added or removed without turning it into assent, consent, authorization, or evidence? |
| Avoiding accidental minor authorization | Use a handoff-readiness button only; collect no minor signature, consent checkbox, assent record, additional input, or audit flag | Approved direction | Does the complete interaction avoid implying that the minor legally authorized the release? Are there supported circumstances in which separate minor assent or signature is nevertheless required? |
| Media-release scope | Limit the built-in agreement to permission for use of image, voice, likeness, appearance, and related media | Approved product boundary; boilerplate pending | Does the complete agreement remain within that lane, and which uses may still trigger specialized minor, entertainment, privacy, publicity, or contract rules? |
| Employment and services confusion | Tell production and the adult signer/guardian that SealProof is not an employment, hiring, performer-services, compensation, or payment agreement | Proposed wording | Are these limitations prominent and accurate, and could any other term or workflow behavior contradict them? |
| Promised compensation | State that any promised payment or compensation must be documented separately | Proposed wording | Is this statement sufficient, and should SealProof exclude releases connected to particular compensation or services arrangements? |
| Unreviewed custom language | Keep the built-in agreement versioned and inside its declared lane; do not treat future custom agreements as legally equivalent | Built-in versioning is current direction; custom agreements undecided | What claims and warnings are appropriate if custom language is ever supported, and should custom agreements be excluded from MVP? |
| Temporary sensitive data | Application-encrypt the PDF and email addresses, use private storage, end access at exactly two hours, and run recurring verified cleanup | Implemented and tested | Are the disclosures, retention period, deletion claims, and incident obligations appropriate for names, emails, photos, signatures, and agreement contents? |
| External provider retention | Disclose that deleting SealProof-controlled storage does not delete copies or data retained by Resend or recipient mail systems | Current policy; final user-facing language pending | What provider-specific disclosures and privacy terms must be shown, and at what point in the workflow? |
| Audit minimization | Retain a random transaction ID, document hash, versions, bounded process/delivery facts, and cleanup time; exclude names, addresses, photos, signatures, agreement text, provider IDs, and capabilities | Implemented core; proposed flags require schema review | Is the record sufficient for its stated evidentiary purpose, are any fields unnecessary, and is the current one-year retention appropriate? |
| Honest product claims | Define sealed as exact-byte hash agreement, submitted as provider API acceptance, and delivered as recipient-server acceptance | Implemented product contract and interface | Do the names, explanations, marketing claims, and disclaimers avoid implying notarization, identity verification, legal validity, guaranteed enforceability, actual receipt, or readership? |

## Product artifacts to review together

Professional review should evaluate the complete experience rather than the
boilerplate in isolation. Supply counsel with current versions of:

- the built-in adult and minor/guardian release text;
- every production, adult signer, minor-information, guardian, handoff,
  review, electronic-consent, signature, delivery, failure, and closeout screen;
- representative adult and minor/guardian PDFs;
- `product-contract.md` and `data-lifecycle.md`;
- the intended privacy notice and terms;
- the minimal audit schema and a field-level description;
- the delivery-state definitions and retry/expiry rules; and
- the exact public marketing claims planned for `sealproof.app`.

Screens and documents should be labeled as implemented, approved direction,
or draft so counsel can distinguish current behavior from planned behavior.

## Preliminary California source flags

These are issue-spotting references, not conclusions about applicability or
compliance. Counsel should identify the governing jurisdictions and replace or
supplement this list as appropriate.

- [California Civil Code section 1633.5](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1633.5.) — agreement to conduct a transaction electronically.
- [California Civil Code section 1633.7](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1633.7.) — legal effect of electronic records and signatures.
- [California Civil Code section 1633.9](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1633.9.) — attribution and effect of an electronic record or signature.
- [California Civil Code section 3344](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=3344.) — consent concerning specified commercial uses of name, voice, signature, photograph, or likeness, including its minor-specific language.
- [California Family Code section 6750](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=FAM&sectionNum=6750.) — defined categories of contracts involving unemancipated minors in art, entertainment, and professional sports.

## Adult electronic workflow

1. Does the separate affirmative electronic-consent acknowledgment adequately
   establish agreement to transact electronically for the intended uses and
   jurisdictions?
2. Does the sequence adequately connect intent to sign with the exact PDF the
   signer reviewed?
3. Are the signature attribution, PDF hash, transaction record, timestamps,
   delivery evidence, and retention disclosures described accurately without
   overstating identity or enforceability?
4. Do any intended transactions fall outside applicable electronic-transaction
   statutes or require additional disclosures, records, or delivery options?

## Minor and guardian workflow

The implemented direction will collect the minor's name and current identifying
photograph, followed by the parent/legal guardian's name, relationship, email,
representation of authority, electronic-consent acknowledgment, and guardian
signature. It will not collect a guardian photograph or minor signature by
default.

1. Is the guardian representation appropriately worded for parents and legal
   guardians without implying that SealProof verified authority?
2. Must the workflow distinguish a parent from a court-appointed guardian in
   its language, evidence, or permitted uses?
3. Is guardian-only authorization appropriate for the intended media-use
   releases, and are there circumstances in which the minor's signature,
   assent, or a different authorization is legally required?
4. Is asking only whether the subject is 18 or older adequate, or does an
   intended use require age, date-of-birth, or other capacity evidence that
   SealProof should instead decline to support?
5. Is one identifying photograph of the minor appropriate and proportionate
   for the stated purpose, and are additional notice, consent, retention, or
   biometric/privacy rules implicated?
6. Should the guardian receive the subject-side copy, and does any jurisdiction
   or use require another recipient or nonelectronic delivery option?
7. Does the age-accessible informational screen remain legally neutral when it
   expressly disclaims consent, assent, signature, authorization, and
   evidentiary purpose?
8. Are there categories of minor media use SealProof should expressly decline
   to support without additional procedures or court approval?

## Media-release boundary

1. Does the built-in agreement stay within a media-use release rather than
   creating employment, performer-services, hiring, compensation, or payment
   obligations?
2. Are the production and signer/guardian warnings prominent and accurate
   enough to prevent users from treating the release as documentation of a
   separate payment or services arrangement?
3. Could the release still fall within specialized minor-entertainment contract
   rules for any intended use despite this narrow product boundary?
4. Should particular production types, uses, jurisdictions, compensation
   arrangements, or custom terms be excluded from the built-in workflow?
5. Are the scope of granted rights, duration, territory, media, revocation,
   editing, sublicensing, and promotional-use terms appropriate and clear?

## Records, delivery, and retention

1. Is sending the exact sealed PDF separately to production and the adult
   signer/guardian sufficient for applicable record-availability requirements?
2. Are “sealed,” “submitted,” and “delivered” defined without overstating what
   Resend or a recipient mail server proves?
3. Are the two-hour temporary-storage limit and one-year minimal-audit retention
   appropriate for evidentiary needs and privacy obligations?
4. Does the proposed minimal audit record retain enough process evidence while
   excluding unnecessary PII and agreement contents?
5. Are disclosures about Resend and recipient mail-provider processing and
   retention sufficient?
6. What should production be instructed to do when signer/guardian delivery
   permanently fails or the email address was entered incorrectly?

## Review outputs requested

Counsel should identify:

- required corrections before public launch;
- recommended but optional improvements;
- unsupported transactions or jurisdictions that should be excluded;
- approved adult and guardian consent/representation language;
- approved informational and limitation language for each participant screen;
- approved built-in release language; and
- any conclusion that requires changing the data lifecycle, audit schema,
  delivery behavior, or product claims.

Every required product change should return to the ordinary SealProof process:
explicit owner approval, documented behavior, implementation, tests, and
privacy-safe evidence.

# Production Readiness Plan

Status: Living plan — priorities and wording remain subject to project-owner
review.

## Purpose

This is the canonical list of product features, design passes, operational
work, and unresolved decisions between the current test deployment and a
responsible production release. It exists so useful observations do not get
lost and so an idea is not mistaken for an approved implementation.

The detailed behavioral contract remains in `product-contract.md`. Security
and architecture decisions belong in `decisions/`; completed live checks
belong in `evidence/`.

## Status labels

| Label | Meaning |
|---|---|
| `NOW` | A production gate or the next deliberately selected work |
| `NEXT` | Important after the current gates |
| `LATER` | Valuable, but not required for the smallest responsible release |
| `DECIDE` | Requires explicit product-owner approval before implementation |
| `DONE` | Implemented and supported by proportionate evidence |

## Current baseline

The controlled test environment has completed and documented:

- a live two-recipient happy path with matching downloaded PDF hashes;
- a live mixed delivered/bounced result and role-specific retry;
- explicit closeout with deletion of SealProof-controlled temporary storage;
- authenticated Resend webhook processing;
- a 60,000-byte, three-page final-document limit supported by remote CPU
  measurements; and
- a public monitoring-only DMARC record alongside the existing mail-routing
  records.

This is meaningful test evidence, not a claim of production readiness.

## Production gates

| Priority | Work | Completion evidence |
|---|---|---|
| `NOW` | Complete and approve the threat model | Assets, trust boundaries, misuse cases, mitigations, and evidence are reviewed rather than left as placeholders |
| `NOW` | Resolve the open product-contract decisions | Production fields, release-text policy, provider disclosure, closeout language, and accessibility behavior are explicit |
| `NOW` | Complete the data-lifecycle record | Every temporary location, provider-retention disclosure, key-recovery rule, and cleanup alert has an owner and policy |
| `NOW` | Define the production environment separately from test | Production hostname, D1 database, private R2 bucket, secrets, DNS, migrations, and deploy command are reviewed without reusing test data or keys |
| `NOW` | Write an operational runbook | Key rotation, secret loss, webhook failure, Resend outage, cleanup failure, rollback, and incident response have safe procedures |
| `NOW` | Establish privacy and legal disclosures | Users can understand what SealProof and Resend process and retain; release language and signature workflow receive appropriate legal review |
| `NEXT` | Complete accessibility and compatibility testing | Keyboard, focus, screen-reader announcements, zoom, camera permissions, touch signing, PDF fallback, and supported browsers/devices are recorded |
| `DONE` | Preserve browser controls after successful finalization | Release credentials are retained before the initial status read; failure leaves the existing release controls available with manual status refresh. Local failure-injection evidence: [browser release controls](evidence/2026-09-11-retained-release-controls.md). Page-reload persistence is not added |
| `DONE` | Connect interrupted-finalization recovery and truthful pending status | Explicit capability-authorized recovery verifies the existing stored PDF, preserves expiry and budget accounting, respects the delivery switch, and shows incomplete finalization accurately. Missing or damaged storage stays unsealed; no re-upload protocol is added. [Local recovery evidence](evidence/2026-09-11-connected-finalization-recovery.md) |
| `NOW` | Continue delivery updates for unresolved recipients | A bounce for one recipient does not stop status refresh for the other pending or delayed recipient; a later authenticated outcome appears automatically, with bounded polling and appropriate expiry/closeout stopping conditions |
| `NEXT` | Test remaining high-value failure paths | Expiry without an open browser, exhausted retries, delayed/unresolved delivery, cleanup recovery, and safe configuration failure have evidence |
| `NEXT` | Add privacy-preserving operational visibility | Alerts and aggregate measurements expose service health without logging PII, document contents, capabilities, or secrets |
| `NEXT` | Create a production launch and rollback checklist | Launch approval, smoke test, DNS change, rollback trigger, and post-launch verification are explicit |

The three browser-control, finalization-recovery, and recipient-polling gates
were identified in code review on September 11, 2026. They predate the anonymous
abuse containment changes and are separate from the selected rolling-budget
and delivery-switch implementation slice. They are recorded as production
correctness gates; this entry does not expand that slice or approve a new
recovery architecture.

## MVP scope decisions

| Priority | Item | Current direction or gate |
|---|---|---|
| `NOW` | Affirmative electronic consent | Before signature, require a separate affirmative statement that the signer agrees to conduct the release electronically and intends the drawn signature to sign the reviewed agreement; place the approved language and evidence of assent in the sealed PDF and approved audit flags |
| `NOW` | Minor/guardian workflow | Approved MVP implementation direction; development may proceed under the defined product boundary, followed by specialist review of the completed workflow, boilerplate, warnings, and claims before public launch |
| `NOW` | Anonymous abuse containment | Approved direction: layered Cloudflare client rate controls, a 90-attempt rolling provider budget, fixed SealProof-controlled email presentation, and a fail-closed delivery switch; client-rate thresholds, implementation, and evidence remain before launch |

The public MVP accepts a bounded limitation: because the browser creates the
PDF, the Worker can prove byte-for-byte continuity but cannot independently
prove that a hostile client used SealProof's official generator. The MVP will
contain abuse and provider cost rather than claim otherwise. Server-authoritative
PDF generation is a future hardening path to reconsider when observed need or
project funding supports its runtime and operational cost; it is not required
for the present MVP.

The approved initial provider budget is 90 Resend submission attempts in a
rolling 24-hour window. Initial role deliveries consume one attempt each and
each retry consumes one. Ten attempts under Resend's current 100-per-day free
allowance remain outside ordinary release traffic as shared operational
headroom, including for controlled diagnostics or a future Contact Us path.
They are not a guaranteed reserve for any one purpose. Per-client Cloudflare
rate thresholds still require approval.

The intended minor workflow asks whether the talent is 18 or older without
collecting a date of birth. A minor answer creates distinct subject and
authorizing-adult roles. SealProof collects the minor's name and one current
identifying photograph. It then collects the parent or legal guardian's name,
relationship to the minor, email address, explicit representation that they
are authorized to consent for the minor, electronic-consent acknowledgment,
and guardian signature.

SealProof does not collect a guardian photograph or minor signature by
default. It records the adult's representation of authority; it does not claim
to independently verify identity, parentage, legal guardianship, or authority.

Before handing the device to the guardian, SealProof gives the minor a short,
age-accessible informational screen that explains:

- what is happening;
- which media permissions production is requesting;
- that the parent or legal guardian will make the authorization decision; and
- that the minor can ask questions or voice concerns to production.

Its only continuation action indicates readiness to hand the device to the
guardian. This step is intentionally not consent, assent, a signature, legal
authorization, or evidence of any of those things. It collects no additional
data and creates no audit flag by default. Its purpose is ethical and
experiential: acknowledge the minor as a participant with a right to
information and a moment to speak, without assigning legal significance to
their interaction.

No interface should state or imply that collecting an adult's representation,
photograph, or signature proves their authority. Product wording and release
language require qualified legal review before public launch. Open legal
questions are preserved in `legal-review-questions.md`; they are review inputs,
not instructions to expand the product or block implementation of this
approved MVP direction.

### Built-in agreement boundary

The intended built-in agreement is exclusively a media-use release granting
the permissions stated in the reviewed agreement for the subject's image,
voice, likeness, appearance, and related media use. It must not present itself
as an employment, hiring, performer-services, compensation, or payment
agreement.

Both production and adult signer/guardian interfaces must clearly explain,
before signature:

- SealProof records the media permissions described in the release;
- it does not create or document employment, hiring, services, compensation,
  or payment terms; and
- any promised payment or other compensation must be documented separately.

The boilerplate must stay within this boundary. Custom agreements, if later
supported, must not silently inherit claims that they are legally equivalent to
the built-in media-use release. Final adult/minor language and the complete
guardian workflow require specialist legal review before public launch.

## Product and workflow backlog

| Priority | Item | Current direction or question |
|---|---|---|
| `NEXT` | Exhausted signer-delivery wording | Replace system-centric “browser copy” language with calm, direct guidance: the contract remains sealed, production may download it, and production must arrange another way to give the signer a copy before closeout |
| `DONE` | Visible bounded retry count | Show two retries, one retry, or no retries remaining for the affected role; the Worker continues to enforce three total attempts per recipient |
| `DECIDE` | Correct a mistyped recipient address | Design an auditable correction flow that cannot silently redirect a signed document or rewrite the sealed PDF |
| `DECIDE` | Signer email opt-out | Keep the decision separate from production, explain consequences to the signer, and determine what receipt mechanism exists when the shared device belongs to production |
| `DECIDE` | Alternative signer delivery | Determine whether SealProof should support another privacy-respecting delivery method or only guide production after email failure |
| `NEXT` | Failure-aware retry guidance | Distinguish permanent bounce, temporary provider failure, delayed delivery, and unresolved evidence so the interface does not encourage pointless retries |
| `NEXT` | Closeout wording and controls | Reconcile documentation with the actual separate Download and Delete/Close controls; explain that download does not itself deliver or delete anything |
| `LATER` | Further image and signature sizing | The current approximately 37 KB representative PDF is acceptable; future layout work may reduce the signature’s document footprint without sacrificing legibility |
| `LATER` | Revisit operational limits using evidence | Change retry, PDF, page, or image limits only after observed usage and renewed cost/CPU testing |

## Reusable presets and QR roadmap

| Priority | Item | Current direction or gate |
|---|---|---|
| `LATER` | Reusable production presets | Major post-MVP feature: populate reviewed production defaults from a deliberately created preset rather than building producer accounts into the first release |
| `LATER` | Opaque preset QR code | Encode a random preset ID plus bounded non-sensitive configuration references; never describe QR contents as private merely because they are encoded or compressed |
| `LATER` | Built-in template reference | Prefer a template and version identifier over embedding the full built-in agreement in the QR |
| `DECIDE` | Custom reusable agreements | Do not place long agreements directly in QR codes; any server storage must treat custom text as potentially containing PII and receive a separate threat model and lifecycle |
| `LATER` | Signed preset configuration | Consider a cryptographic signature so the app can detect configuration tampering without treating the preset signature as the final PDF hash or as producer identity |
| `LATER` | Preset lifecycle controls | Define creation, expiry, revocation, version replacement, enumeration resistance, abuse control, and behavior when a QR references a retired template |

The preset signature and document hash answer different questions: a preset
signature could establish that configuration was not altered after SealProof
issued it, while the PDF hash identifies the exact completed release.

## Analytics boundaries

| Priority | Item | Current direction or gate |
|---|---|---|
| `LATER` | Opaque preset usage analytics | A random preset ID may measure use of the knowingly reusable artifact, subject to an explicit purpose, bounded retention, access controls, and a prohibition on inferring the creator's identity |
| `DECIDE` | Free-user longitudinal analytics | If an email-derived HMAC identifier is ever used, require explicit opt-in that is unchecked by default; describe it as pseudonymous, never encrypted or anonymous |
| `LATER` | Random browser/device analytics ID | Less directly linkable than an email-derived value but still a tracking identifier requiring disclosure, retention limits, and a decision about consent; continuity disappears when storage is cleared or devices change |
| `NOW` | Signer analytics prohibition | Never create longitudinal signer identifiers or use signer data for product analytics |

No analytics identifier may be used for advertising or silently joined to the
transaction audit trail. Product improvement should begin with aggregate,
non-identifying operational measurements; longitudinal free-user tracking is
not required for MVP.

## Data separation and minimal audit

- Audit records, optional free-user analytics, and future preset analytics may
  initially use separate tables and separate code paths in one database.
- They must not share a convenient person-level identity key or permit routine
  cross-purpose joins.
- Physical databases become preferable if access permissions, retention,
  scale, incident boundaries, or the need to prevent accidental joins diverge.
- The audit record must remain deliberately minimal: random transaction ID,
  server timestamp, document hash and algorithm/version, workflow/schema and
  applicable built-in-template versions, approved process flags, role-level
  delivery outcome/timestamps without addresses, and cleanup completion time.
- Names, email addresses, photos, signatures, agreement text, provider message
  IDs, and reusable access capabilities must never migrate into the audit
  record.

The external proposal called this record “permanent,” but the currently
approved lifecycle deletes it one year after cleanup. Changing that retention
period is a separate `DECIDE` item requiring a stated purpose, privacy review,
and updates to the product contract, data lifecycle, schema, and tests. Until
then, “minimal audit record” means the existing one-year record.

## Privacy and trust design pass

The interface should radiate respect for privacy without making users decode
infrastructure language. Review every screen for:

- what information is being requested and why;
- whether production or the signer is making the decision;
- what leaves the device and at which action;
- what SealProof temporarily stores;
- what Resend and recipient mail systems retain independently;
- the exact two-hour deadline and the effect of explicit closeout;
- whether a status means sealed, submitted, delivered, failed, or opened; and
- whether failure language gives an honest next action without blame or panic.

No interface should imply that “delivered” means opened, that local download
means signer receipt, or that deleting SealProof's copy deletes email-provider
or recipient copies.

## Visual and site-integration pass

The project-owner-selected palette is:

| Token | Hex | Intended role |
|---|---|---|
| Onyx | `#000F08` | Grounding color for headers, footers, and navigation |
| Rusty Spice | `#B93C1C` | Primary actions, emphasis, and progress accents |
| Charcoal | `#4D4847` | Secondary text and subdued interface elements |
| Mint Cream | `#F4FFF8` | Main working background |
| Cool Steel | `#8BAAAD` | Secondary information, privacy/audit callouts, and supporting or inactive UI |

These roles are design intent, not permission to use every pairing. The design
pass must verify contrast for normal text, large text, controls, focus rings,
visited links, disabled states, errors, and progress states. Cool Steel should
not be assumed legible as small text on Mint Cream without a contrast check.

| Priority | Work | Guardrail |
|---|---|---|
| `NEXT` | Apply the approved palette and select typography | Preserve legibility, contrast, hierarchy, and calm privacy messaging; document reusable design tokens rather than scattering hex values |
| `NEXT` | Integrate with the existing `sealproof.app` Coming Soon site | Decide whether the marketing homepage and release tool share one deployment, routes, and visual system before moving the tested workflow |
| `NEXT` | Create responsive layouts | Prioritize the shared-phone handoff and touch-signature workflow without neglecting desktop use |
| `NEXT` | Refine progress and status presentation | Progress may communicate real completed stages but must never manufacture certainty while waiting |
| `LATER` | Add restrained brand polish | Do not obscure agreements, consent, delivery state, retry limits, or deletion actions with decorative treatment |
| `LATER` | Add a favicon and final metadata | Complete after the visual identity is approved |

## Email authentication and deliverability

| Priority | Work | Current state |
|---|---|---|
| `DONE` | Establish monitoring-only DMARC | `_dmarc.sealproof.app` publishes `v=DMARC1; p=none;` |
| `NEXT` | Choose a DMARC reporting destination | Prefer a dedicated reviewed mailbox or service; do not clutter the releases inbox or disclose reports to an unreviewed processor |
| `NEXT` | Inventory every legitimate domain sender | Required before changing DMARC enforcement |
| `LATER` | Consider `quarantine` or `reject` | Only after reviewing alignment reports and confirming every approved sender consistently passes SPF or DKIM alignment |
| `NEXT` | Monitor Resend limits and bounce behavior | Account for two initial role messages plus bounded retries; avoid needless sends to permanent failures |

## Evidence still worth collecting

- A live automatic-expiry cleanup with the browser closed.
- A live or safely simulated exhausted-retry interface and closeout.
- A delayed-delivery event that later resolves.
- An unresolved contradictory-event path.
- Representative phone, tablet, desktop, camera, touch, keyboard, zoom, and
  assistive-technology walkthroughs.
- A production-like deployment rehearsal using isolated disposable resources
  before any real production migration.

Evidence documents must continue to omit PII, document contents, email
addresses, provider message IDs, usable capabilities, and secret values.

## Working method

For each selected item:

1. define the observable user behavior or operational claim;
2. identify privacy, security, cost, and failure implications;
3. obtain explicit approval for consequential decisions;
4. implement the smallest auditable slice;
5. run automated checks and a proportionate manual test;
6. record evidence without sensitive data; and
7. commit and deploy through an explicitly named environment configuration.

Move an item to `DONE` only when the implementation and its evidence both
exist. Update this plan whenever testing reveals a new product gap.

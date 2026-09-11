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
| `NEXT` | Test remaining high-value failure paths | Expiry without an open browser, exhausted retries, delayed/unresolved delivery, cleanup recovery, and safe configuration failure have evidence |
| `NEXT` | Add privacy-preserving operational visibility | Alerts and aggregate measurements expose service health without logging PII, document contents, capabilities, or secrets |
| `NEXT` | Create a production launch and rollback checklist | Launch approval, smoke test, DNS change, rollback trigger, and post-launch verification are explicit |

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

| Priority | Work | Guardrail |
|---|---|---|
| `NEXT` | Define typography and color palette | Preserve legibility, contrast, hierarchy, and calm privacy messaging |
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

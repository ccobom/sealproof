# Threat Model

Status: Draft — first architecture-grounded assessment created September 11,
2026. It is not an assertion that SealProof is secure or production-ready.
Risk priorities and acceptances require project-owner review.

## Scope

This model covers the current controlled adult test application and the
approved shared-device minor/guardian MVP direction:

- React/TypeScript browser workflow and browser-generated PDF;
- Cloudflare Worker API and scheduled cleanup;
- encrypted temporary state in D1 and private R2;
- Turnstile admission;
- direct-attachment Resend delivery and authenticated webhooks;
- recipient mail systems; and
- the one-year minimal audit record.

Reusable presets, preset QR codes, analytics, custom reusable agreements, and
remote guardian continuation are outside this model until separately approved.

## Rating method

| Rating | Meaning |
|---|---|
| Critical | Could systematically expose or alter many sensitive releases, compromise signing keys/secrets, or make core trust claims false |
| High | Could expose or misdeliver one or more releases, enable meaningful abuse/cost, or undermine consent, integrity, delivery, or deletion |
| Medium | Material harm is bounded, requires stronger preconditions, or primarily affects reliability and user understanding |
| Low | Limited impact or straightforward recovery, while still worth tracking |

Likelihood is **Likely**, **Plausible**, or **Unlikely** based on the current
design, not a statistical claim. A risk may remain high even when likelihood is
low.

Status meanings:

- **Controlled:** implemented mitigation has proportionate evidence;
- **Partial:** meaningful controls exist but a gap remains;
- **Open:** no sufficient production control or evidence yet;
- **Accepted limitation:** product deliberately does not solve the underlying
  issue and must describe that boundary honestly; and
- **Planned:** approved behavior is not implemented yet.

## People and assets to protect

| Asset | Protection objective |
|---|---|
| Adult signer, minor, and guardian autonomy | Participants understand the requested media permission, who authorizes it, and what the interaction does and does not mean |
| Names, email addresses, photographs, signatures, agreement text, and PDFs | Confidentiality and deletion within SealProof's stated lifecycle |
| Exact reviewed PDF | No byte changes between review, sealing, retry, download, and role-specific delivery |
| Consent and authority evidence | Accurately record actions and representations without inventing identity, capacity, understanding, or guardian verification |
| Delivery evidence | Keep production and subject-side outcomes separate; never equate provider submission, mail-server acceptance, opening, and reading |
| Status and closeout capabilities | Only the browser holding the high-entropy bearer value may inspect, retry, download, or close that active release |
| Worker secrets and encryption keys | Confidentiality, separation, rotation, and controlled use |
| Minimal audit record | Integrity, strict field minimization, one-year expiry, and no quiet growth into a PII archive |
| Service availability and free-tier capacity | Resist storage, CPU, Turnstile, D1, R2, and Resend quota exhaustion |
| sealproof.app sender and product reputation | Prevent phishing, spam, spoofing, misleading claims, and repeated mail to invalid recipients |
| Source, configuration, and deployment history | Prevent unauthorized or accidental code/configuration from reaching test or production |

## Actors and trust assumptions

| Actor | Trust assumption |
|---|---|
| Production representative | May make mistakes, enter false information, pressure participants, misuse a release, or use a modified client; not treated as trusted server input |
| Adult signer | May make mistakes or false statements; must control their own review, acknowledgment, photo choice where applicable, and signature interaction |
| Minor subject | Is a participant deserving information and agency; is not a legal authorizer in SealProof's planned workflow |
| Parent/legal guardian | Makes the subject-side authorization in the minor path and may misrepresent identity, relationship, or authority; SealProof records but does not verify the representation |
| Person holding the shared device | Can see data currently displayed and may access browser-held capabilities while the page remains active |
| External attacker or abusive human | May modify browser requests, automate or manually pass challenges, guess identifiers, steal a device, phish, exhaust quotas, or exploit dependencies |
| Browser and operating system | Trusted to execute delivered code and provide Web Crypto/camera/file behavior correctly; extensions, malware, screenshots, clipboard, downloads, caches, and memory reclamation are outside SealProof's full control |
| Cloudflare Worker | Trusted application boundary with plaintext access during active processing and access to service secrets |
| Cloudflare D1/R2/Workers/Turnstile | External processor and infrastructure boundary; platform compromise or privileged access is not eliminated by application controls |
| Resend/Svix | External delivery/event boundary that necessarily processes recipient addresses and plaintext email/PDF content |
| Recipient mail providers and inbox users | External retention and access boundary outside SealProof deletion control |
| Repository contributor/deployer | Highly privileged supply-chain actor capable of changing code, dependencies, configuration, migrations, and public claims |

Participant truthfulness and legal authority are not technical trust
assumptions. SealProof proves only the bounded process facts it actually records.

## Trust boundaries and exchanges

~~~text
Production / adult / minor / guardian
                  |
                  | visible shared-device interaction
                  v
Browser memory and generated PDF
  |            |                 |
  | Turnstile  | HTTPS API       | local download
  v            v                 v
Cloudflare   Worker boundary   Production-controlled file
Turnstile      |       |
               |       +---- encrypted temporary state ----> D1
               |       +---- encrypted PDF ciphertext -----> private R2
               |       +---- plaintext email + PDF --------> Resend
               |                                      |
               | signed webhook                       +--> recipient mail systems
               +<-------------------------------------+
~~~

Every arrow crossing a boundary is independently validated or explicitly
treated as external. TLS protects transport to Cloudflare and Resend, but TLS
does not reduce what those endpoints can see after decryption.

## Existing defense layers

- Strict same-origin HTTPS checks on application API requests.
- Zod schemas, content-type checks, declared and actual byte limits.
- Turnstile server verification bound to expected hostname and action.
- Five-minute AES-GCM finalization tickets binding emails, hash, workflow, and
  a random admission ID.
- Consumed-admission replay prevention.
- Browser SHA-256 plus independent Worker SHA-256 over the exact PDF.
- Three-page browser-generator limit and independent 60,000-byte Worker limit.
- AES-GCM per-release PDF and address data keys wrapped by versioned,
  independent Worker keys.
- Ciphertext-only private R2 storage and encrypted email envelope in D1.
- High-entropy status/download capabilities with only hashes stored in D1.
- Separate role-specific Resend requests and deterministic idempotency keys.
- Signed, bounded, duplicate-safe Resend webhook processing.
- Bounded retries with no extension of the original expiry.
- Exact two-hour authorization expiry plus recurring verified cleanup.
- One-year minimal-audit expiry.
- No default Wrangler configuration; test and production deployments must name
  an explicit reviewed manifest.

These layers limit particular risks. None of them establishes that the human
participants are truthful, authorized, uncoerced, or legally capable.

## Threat and failure register

| ID | Threat or failure | Likelihood | Impact | Current control/evidence | Residual gap and required action | Status |
|---|---|---|---|---|---|---|
| T01 | Shared-device PII remains visible or recoverable after handoff/closeout | Plausible | High | Volatile React state; no intentional local/session storage; explicit handoffs and browser-clear action | Test back navigation, autofill, downloads, camera frames, object URLs, crash/reload, and browser restoration; make clearing understandable and reliable | Partial |
| T02 | Cross-site scripting or compromised browser dependency steals form data, PDF, signature, or capabilities | Plausible | Critical | React escapes ordinary text; secrets are not shipped to browser; dependency lockfile exists | Add and test CSP and other security headers, minimize third-party browser code, audit dependencies, and define update review; browser extensions/malware remain outside control | Open |
| T03 | Clickjacking or deceptive embedding causes unintended actions | Plausible | High | Same-origin API checks reduce cross-origin request abuse | Add anti-framing policy and test handoff, consent, retry, download, and closeout screens | Open |
| T04 | Modified client submits arbitrary content disguised as a PDF | Likely for an abuser | High | Worker requires a PDF header, 60 KB maximum, valid ticket, matching hash, and one-time admission | The MVP accepts that hash agreement proves equality with attacker-declared bytes, not use of SealProof's generator. Implement the approved layered containment; revisit server-authoritative generation if need or funding justifies it | Accepted limitation / implementation gate |
| T05 | Human or bot uses SealProof to send spam, phishing PDFs, or harassing messages | Plausible | Critical | Turnstile, request limits, short ticket, maximum three attempts per role, separate provider idempotency | Approved direction: Cloudflare client rate controls, exact aggregate provider budget, fail-closed delivery switch, fixed email presentation, monitoring, and abuse response; implement and evidence before launch | Open — launch gate |
| T06 | Automated traffic exhausts Worker, D1, R2, Turnstile, or Resend free limits | Plausible | High | Small request/PDF limits, private storage, two-hour expiry, bounded retries | Establish rate thresholds, daily provider budget, fail-closed quota behavior, alerting, and load evidence including one-minute cron use | Open — launch gate |
| T07 | Email typo sends the sealed PDF and PII to the wrong recipient | Plausible | High | Email syntax validation and final workflow review; separate role messages | Add prominent address confirmation before sealing; determine legally reviewed correction/failure path. Email recall cannot be promised | Partial |
| T08 | Production or guardian enters false identity, age path, relationship, or authority | Plausible | High | Planned explicit representation; PDF/process evidence; limitation language | Accepted product boundary: do not claim verification. Legal review must identify unsupported uses; threat cannot be technically eliminated without changing product scope | Accepted limitation / planned |
| T09 | Production coerces, rushes, or hides context from an adult or minor | Plausible | High | Explicit handoffs, full PDF review, separate acknowledgments planned, minor-information friction planned | Shared-device workflow cannot guarantee voluntariness. Strengthen plain-language screens and test comprehension; avoid marketing claims of informed/uncoerced consent | Partial / planned |
| T10 | Minor-information step is mistaken for consent or assent | Plausible | High | Approved design collects no minor signature/input/audit flag and labels the step informational | Implement exact neutral copy and test adult/minor comprehension; legal review before launch | Planned |
| T11 | Guardian-only workflow is mistaken for verified guardianship | Plausible | High | Planned representation and explicit non-verification boundary | Apply limitation consistently in UI, PDF, email, docs, and marketing; legal review supported uses | Planned |
| T12 | Browser PDF shown for review differs from uploaded/stored/delivered bytes | Unlikely | Critical | Exact browser bytes hashed; ticket binds hash; Worker rehashes; ciphertext and plaintext reverified; live recipient hashes matched | Preserve immutable byte flow and rerun evidence after any generator/delivery change | Controlled |
| T13 | Oversized or malformed PDF causes CPU/memory exhaustion or unexpected recipient behavior | Plausible | High | 60 KB Worker limit, header check, browser 3-page generator rule, remote CPU tests | Worker deliberately does not fully parse PDF and cannot enforce page count against a hostile client; covered by T04 abuse gate | Partial |
| T14 | R2 disclosure exposes finalized documents | Plausible | Critical | Private bucket plus application-level per-release AES-GCM; R2 stores ciphertext only | Worker/key compromise can decrypt. Verify bucket policy, least privilege, key operations, and no accidental public binding | Partial |
| T15 | D1 disclosure exposes email addresses or usable release capabilities | Plausible | High | Emails are AES-GCM encrypted; only capability hashes stored; temporary detailed rows cascade at cleanup | D1 plus Worker key compromise reveals addresses. Define access control, backups/export policy, key rotation, and incident response | Partial |
| T16 | Worker secret or key compromise exposes active PII or permits forged operations | Plausible | Critical | Secrets live in Cloudflare secret storage; PDF and ticket keys are independent and versioned | Rotation, revocation, overlap, loss, emergency deployment, and breach procedures are unfinished; never log or copy secrets | Open — launch gate |
| T17 | Key rotation makes active releases undecryptable or retains old keys indefinitely | Plausible | High | Version labels exist in encrypted envelopes | Write and test rotation/retirement rules covering the maximum two-hour active window and deployment rollback | Open |
| T18 | Capability leaks through logs, URLs, history, referrers, screenshots, or device access | Plausible | High | Capability stays in browser memory and Authorization header; D1 stores only hash; responses use no-store | Verify platform/application logs redact Authorization; add referrer/CSP controls; test error reporting; anyone controlling the active device remains authorized | Partial |
| T19 | Cross-site request or forged status/retry/closeout request | Unlikely | High | Exact HTTPS origin/hostname checks, bearer capabilities, credentials omitted, strict routes/methods | Add security-header tests and retain concealed not-found behavior; same-device malicious code remains covered by T02 | Controlled / partial |
| T20 | Finalization ticket is altered, replayed, stolen, or used after expiry | Unlikely | High | AES-GCM, authenticated context, five-minute hard expiry, admission UUID, consumed marker, strict parser | Theft within five minutes remains possible on a compromised device; never place ticket in URLs/logs | Controlled |
| T21 | Forged, altered, replayed, oversized, or contradictory webhook changes delivery evidence | Unlikely | High | Original-body signature verification, body limit, approved event schema, Svix replay ID, payload hash, D1 constraints, unresolved conflict state | Monitor repeated verification failures without logging bodies; maintain secret rotation/recovery procedure | Controlled / partial |
| T22 | Ambiguous Resend acceptance or retry creates duplicate email | Plausible | Medium | Deterministic idempotency per immutable role/attempt; attempts stored durably; bounded retry | Maintain exact retry payload and test provider idempotency changes; provider behavior remains external | Partial |
| T23 | Permanent bounce is retried repeatedly, consuming quota and harming reputation | Plausible | Medium | Two retries maximum per role; visible remaining count; failure remains honest | Add failure-aware guidance and consider suppressing pointless retry for known permanent outcomes after product review | Partial |
| T24 | Resend/provider compromise or retention exposes PDF, address, or message | Plausible | Critical | Separate messages disclose only one role address each; no public attachment URL; provider processing documented | Unavoidable external trust boundary. Review provider terms/security/retention, minimize message content, disclose accurately, and define provider incident response | Accepted external risk / open review |
| T25 | Delivered is interpreted as read, received by the intended human, or legally effective | Plausible | High | Product contract defines delivery as recipient-server acceptance; role states separate; UI language tested | Review every UI/email/marketing phrase and legal copy; mail-server evidence cannot prove readership or identity | Partial |
| T26 | Cleanup does not physically delete temporary PII/PDF on time | Plausible | Critical | Authorization expires exactly at two hours; one-minute cron; idempotent R2 delete/absence check; D1 cascade; retry after bounded failures; tests and live closeout evidence | Load-test scheduled cleanup under backlog within Free-plan CPU, add alerting, inspect backup/provider retention, and verify live closed-browser expiry | Open — launch gate |
| T27 | Cleanup runs after R2 deletion but before D1 completion, or vice versa | Plausible | High | Cleanup-start marker, idempotent R2 deletion, absence confirmation, retriable D1 finalization | Add operational alert/runbook and live recovery evidence; never report cleanup complete before both stages succeed | Partial |
| T28 | Minimal audit silently accumulates PII or persists beyond one year | Plausible | High | Strict current schema, field constraints, separate temporary tables, scheduled audit expiry | Review every migration, forbid free text/identity joins, test one-year deletion operationally, and define backup/export handling | Partial |
| T29 | Audit hash/transaction data is altered or deleted early | Unlikely | High | D1 constraints and application state transitions; evidence docs record representative hashes | Define database access, backup, restore, migration review, tamper detection, and incident process. SHA-256 alone does not authenticate the audit database | Open |
| T30 | Logs, diagnostics, analytics, or monitoring capture PII, document contents, provider IDs, capabilities, or secrets | Plausible | Critical | Bounded failure categories; evidence-redaction rules; no intended analytics; response bodies avoid raw errors | Inventory Cloudflare/Resend/browser logs, set retention/access, add safe structured logging policy and tests before monitoring expansion | Open — launch gate |
| T31 | Dependency, build, repository, or deployment compromise ships malicious code | Plausible | Critical | Git history/lockfile, explicit environment manifests, no default Wrangler config, manual review/check/deploy process | Add branch/account protections, MFA, dependency review/scanning, pinned CI, artifact provenance, least-privilege deploy credentials, and rollback runbook | Open — launch gate |
| T32 | Test configuration, keys, data, or hostname are reused in production | Plausible | Critical | Separate production template; placeholder guard; explicit named deploy commands; test hostname | Create isolated production D1/R2/keys/Turnstile/Resend webhook and rehearse configuration without copying test secrets/data | Open — launch gate |
| T33 | DMARC/SPF/DKIM failure permits spoofing or harms deliverability | Plausible | High | Verified Resend domain; Cloudflare routing SPF/MX; monitoring-only DMARC; successful live delivery | Inventory all senders, establish privacy-reviewed reports, monitor alignment, then decide enforcement; monitoring mode does not request rejection | Partial |
| T34 | Camera captures more than intended, retains stream, or exposes metadata | Plausible | High | Explicit capture/retake/clear flow; browser re-encoding and size controls; no separate image upload | Verify stream shutdown, permission denial, metadata stripping, camera indicators, minor photo rules, and device/browser behavior | Partial / planned |
| T35 | Accessibility failure prevents meaningful review, consent, signature, status, or closeout | Plausible | High | Semantic controls and visible states exist in parts of the app | Complete keyboard, focus, screen-reader, live-region, zoom, contrast, PDF fallback, and touch testing before launch | Open — launch gate |
| T36 | Legal/privacy wording overstates what technical controls prove | Plausible | High | Product contract and legal-review brief explicitly constrain claims | Specialist review of completed screens/PDF/emails/marketing remains mandatory before public launch | Open — launch gate |

## Highest-priority launch gates

The first threat-model pass identifies these security/privacy gates before a
public production launch:

1. **Anonymous delivery abuse:** prevent a modified or human-operated client
   from using SealProof as a bounded but repeatable arbitrary-PDF mailer.
2. **Rate and quota controls:** protect Worker, D1, R2, and Resend capacity with
   enforceable limits beyond Turnstile.
3. **Browser containment:** deploy and test CSP, anti-framing, referrer, and
   related security headers; review browser dependencies.
4. **Secrets and operations:** document and test key/secret rotation, incident
   response, deployment authorization, and rollback.
5. **Deletion operations:** prove scheduled cleanup under backlog/CPU limits,
   verify a closed-browser live expiry, and alert on repeated failure without
   PII.
6. **Logging and monitoring:** inventory provider/platform logs and add
   privacy-preserving operational visibility.
7. **Accessibility:** demonstrate that review, acknowledgment, signature,
   delivery status, and closeout are usable without the default visual/touch
   path.
8. **Production isolation and legal/privacy review:** create independent
   production resources and have the completed participant experience,
   agreement, disclosures, and claims professionally reviewed.

This ordering does not require solving future QR, analytics, remote-guardian,
or custom-agreement threats before the current MVP.

## Evidence already available

| Claim | Evidence |
|---|---|
| Exact reviewed bytes survive sealing and two live deliveries | evidence/2026-09-10-live-happy-path.md |
| Mixed delivered/bounced state, role retry, stable hash, and failure closeout | evidence/2026-09-11-live-failure-retry.md |
| Public SPF/MX/monitoring-DMARC baseline | evidence/2026-09-11-email-authentication-baseline.md |
| Remote CPU margin for the approved document ceiling | spikes/0046-direct-attachment-remote-cpu-plan.md |
| Encryption, capability, webhook, retry, and cleanup mechanics | Focused decision/spike records and automated tests |

Evidence proves only the tested claim under its recorded conditions. A passing
happy path does not resolve abuse, compromise, coercion, accessibility,
provider, legal, or operational risks.

## Accepted product limitations requiring clear disclosure

- SealProof does not verify identity, age, parentage, guardianship, authority,
  capacity, truthfulness, voluntariness, or legal enforceability.
- SHA-256 proves byte equality, not identity, consent, authorization, time of
  human action, or legal validity.
- Mail-server acceptance does not prove that the intended person received,
  opened, read, or understood the release.
- Deleting SealProof-controlled storage does not delete browser downloads,
  screenshots, Resend records, email-provider data, or recipient copies.
- A person controlling the unlocked shared device can see current page data and
  exercise browser-held capabilities.
- A fully compromised Worker or browser can access plaintext while it is being
  processed; application encryption primarily reduces stored-data exposure.
- The built-in release is not an employment, hiring, performer-services,
  compensation, or payment agreement.

These limitations are not permission to use vague disclaimers as substitutes
for feasible controls.

## Required follow-up process

For each open threat:

1. choose whether to mitigate, avoid by narrowing scope, transfer to a reviewed
   provider, or explicitly accept;
2. document the decision and user-visible consequence;
3. implement the smallest control at the correct trust boundary;
4. add tests for both success and bypass attempts;
5. collect privacy-safe operational evidence where necessary; and
6. update this register's residual risk and status.

Do not mark this threat model approved until every launch gate has an owner,
decision, and completion criterion.

## Approval record

- Reviewed by:
- Date:
- Notes:

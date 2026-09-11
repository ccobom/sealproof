# 0005 — Anonymous Admission and Abuse Control

- Status: Accepted for incremental implementation
- Date: September 9, 2026
- Decision owner: Project owner

## Context

Requiring accounts would add permanent identifiers, passwords or third-party identity data, recovery workflows, and a larger security boundary. Allowing unrestricted anonymous finalization would make SealProof an attractive target for automated email abuse and storage exhaustion.

## Decision

The first version will permit production representatives to create releases without accounts. Anonymous access does not mean unprotected access.

- Require Cloudflare Turnstile immediately before the first server-side admission action.
- Validate every token through Siteverify in the Worker; the browser widget alone is never authorization.
- Require the configured production hostname and the exact `release-finalization` action.
- Do not explicitly forward the visitor IP address to Siteverify. Cloudflare documents `remoteip` as optional.
- Do not store IP addresses in D1 audit or temporary release state.
- Add strict request and PDF size limits, short-lived finalization tickets, replay prevention, and rate controls as separate reviewed layers.
- Treat bot protection as risk reduction, not proof that a requester is trustworthy or human.

As of September 9, 2026, Cloudflare documents Turnstile Free as suitable for most production applications with unlimited challenges, and documents tokens as single-use with a five-minute validity period. These service facts must be rechecked before production launch.

## Privacy consequences

Turnstile necessarily processes browser and challenge signals through Cloudflare. Cloudflare states that Turnstile does not access form entries or user communications and processes data needed for the security function. SealProof will disclose Turnstile as an anti-abuse service rather than suggesting the workflow involves only SealProof and Resend.

The Siteverify request contains the Turnstile token, Turnstile secret, and a random idempotency identifier. It does not contain release fields, email addresses, PDF bytes, transaction IDs, or an explicitly supplied IP address.

## Sources reviewed

- [Cloudflare Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Cloudflare Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)
- [Cloudflare Turnstile overview and privacy summary](https://developers.cloudflare.com/turnstile/)

## Approval record

- Approved by: Project owner
- Date: September 9, 2026
- Notes: Anonymous operation with size limits and bot protection is approved. Production rate-control thresholds and the final ticket protocol remain separate gates.

## September 11, 2026 amendment — public MVP containment

The project owner approved layered anonymous protection as the public-MVP
strategy. The MVP will not add production accounts or claim that the Worker
can authenticate the origin or meaning of browser-generated PDF bytes.

The approved control direction is:

- retain Turnstile, the short-lived one-use admission ticket, the 60,000-byte
  document limit, and the three-attempt-per-recipient ceiling;
- add per-client Cloudflare rate controls without retaining IP addresses in
  SealProof's D1 data;
- add an exact aggregate daily delivery budget enforced by SealProof before a
  provider submission is authorized;
- add a fail-closed emergency delivery switch;
- keep the sender identity, message framing, and attachment limits controlled
  by SealProof rather than accepting user-supplied email presentation; and
- add privacy-preserving monitoring and an operational abuse-response path.

The Cloudflare rate-control layer is a burst and repeated-use defense, not an
accounting system. The D1 aggregate delivery budget is the authoritative cost
circuit breaker. Its records must contain aggregate counts only—not email
addresses, IP addresses, document identifiers, capabilities, or contents.

### Accepted MVP limitation

An attacker controls their browser. Matching an admission-bound browser hash
to the Worker's hash proves that SealProof sealed the submitted bytes without
changing them; it does not prove that those bytes were created by the official
SealProof generator or contain only the intended agreement. A client-side
nonce, signature, or signed hash would not remove that limitation because the
attacker can choose the bytes presented to client-side code.

This limitation is accepted for the bounded anonymous MVP provided that the
approved abuse and cost controls are implemented and evidenced before public
launch. If observed abuse, user funding, purchases, donations, or scale justify
the additional runtime and operational cost, revisit server-authoritative PDF
construction from strictly validated structured inputs. That future path must
be developed and measured separately and may require a paid Worker plan or a
different backend runtime. It is not an unrecorded MVP dependency.

The project owner approved this direction on September 11, 2026.

### Approved initial provider budget

- Ordinary SealProof release delivery and retry work may authorize at most 90
  Resend submission attempts in a rolling 24-hour window.
- Each independently addressed initial delivery consumes one attempt. The
  current two-recipient workflow therefore requires two available attempts.
  The enforcement boundary must reserve a server-derived required-attempt
  count rather than permanently assuming every future delivery mode uses two.
- Each role-specific retry consumes one additional attempt.
- An outbound request with an ambiguous or failed provider result still
  consumes its reservation because SealProof cannot safely assume that Resend
  did not receive it.
- New admission must stop before signer data is collected when fewer than two
  ordinary-delivery attempts are available. Finalization must check and
  reserve capacity atomically again to handle intervening use. A retry needs
  one available attempt and does not bypass the budget.
- Capacity is not queued for automatic later delivery. When unavailable, the
  interface must say that delivery is temporarily unavailable and must not
  claim that the PDF was uploaded, emailed, or scheduled.

The remaining ten attempts under Resend's current 100-email daily free-plan
allowance are deliberately outside the ordinary release budget. They provide
shared operational headroom for controlled diagnostics, accounting or timing
differences, and a possible future Contact Us delivery path. They are not a
separate queue, are not guaranteed to a particular purpose, and must not be
silently exposed to ordinary release or retry traffic.

The 90-attempt threshold is configuration, not a permanent product constant.
Provider limits and pricing must be rechecked before launch and whenever the
Resend plan changes. The implementation must enforce the rolling window from
SealProof's own conservative attempt records rather than assuming that a
calendar-day reset exactly matches the provider's accounting.

A future production choice to receive its copy by direct download may reduce
the initial email reservation from two attempts to one. That feature is not
part of this implementation. When reviewed later, the Worker—not an arbitrary
browser number—must derive the required count from a closed, admission-bound
delivery-mode value. Selecting download is not evidence that a download
completed; those are separate events. Any signer-side delivery choice remains
a separate signer decision and legal/product review.

Per-client Cloudflare rate thresholds remain a separate explicit approval
before implementation.

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

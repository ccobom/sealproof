# 0022 — Turnstile Server Verification Boundary

- Date: September 9, 2026
- Result: Isolated local verification gate passed
- Related decision: `docs/decisions/0005-anonymous-admission-and-abuse-control.md`

## Question

Can SealProof validate a bounded Turnstile token only on the server, require its own hostname and action, omit form data and explicit IP forwarding, and fail closed without exposing provider details?

## Scope

This is an injected local adapter test. It does not load the browser widget, call Cloudflare, use a real sitekey or secret, create D1/R2 state, or process personal information.

## Boundary

The adapter rejects empty and greater-than-2,048-character tokens before making a request. It posts JSON only to Cloudflare's fixed Siteverify URL with the secret, response token, and a random retry idempotency key. It deliberately omits `remoteip`.

Success requires an HTTP success response, valid JSON, `success: true`, the configured hostname, and the exact `release-finalization` action. Token rejection remains distinct internally from service unavailability so the eventual interface can ask for a fresh challenge without disclosing Cloudflare error details.

## Evidence

On September 9, 2026, all four TypeScript checks passed, all 110 tests across 23 files passed, and the Vite production build passed. Focused tests confirmed the exact fixed endpoint and minimal request fields, successful matching verification, rejection of unsuccessful results and substituted hostname/action values, pre-network token bounds, and fail-closed behavior for network, HTTP, JSON, and configuration failures.

## Remaining gates

- Wrap this verifier in the strict anonymous-admission HTTP route.
- Add the widget only after the local route and finalization-ticket behavior pass.
- Use Cloudflare's published test keys before any production widget or secret is created.

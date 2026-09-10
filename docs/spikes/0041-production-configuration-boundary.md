# 0041 — Production Configuration Boundary

## Question

Can production refuse unsafe or incomplete API configuration without allowing
an unrelated email outage to disable mandatory privacy cleanup?

## Decision

All production API routes pass through one structural validator before reaching
external fetch, D1, or R2. It validates binding methods, the public hostname,
version labels, sender format, provider secrets, exact 32-byte key encodings,
the active provider key, and separation among the three cryptographic purposes.
Temporary decoded validation buffers are overwritten.

Scheduled cleanup uses a deliberately narrower check for D1 and R2. This means
missing Resend, Turnstile, or cryptographic secrets make the interactive API
unavailable but do not stop deletion of already-expired temporary records.

## Deployment template

The versioned production manifest names all six required secrets without values
and contains explicit hostname and D1 placeholders. It does not change the
currently deployed synthetic-spike manifest and must not be deployed until the
placeholders and resource identities are reviewed.

## Automated evidence

Tests cover a complete valid boundary, every required public and secret field,
cryptographic key-purpose separation, binding structure, fail-closed API
behavior, and cleanup independence from email configuration. All 186 tests
across 38 files and the Vite production build passed. Wrangler also parsed and
built the production manifest with `--dry-run`; it displayed the intentional
placeholders and exited without uploading or provisioning anything.

## Next gate

Run automated checks, then obtain the project owner's production hostname choice
before creating or connecting Cloudflare resources.

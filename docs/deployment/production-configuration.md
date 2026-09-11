# Production Configuration

`wrangler.production.jsonc` is a reviewed template, not deployment approval. It
remains intentionally unusable while either `REPLACE_WITH_...` placeholder is
present. There is intentionally no default `wrangler.jsonc`: every deployment
must name an explicitly reviewed configuration. `npm.cmd run deploy:test`
builds and deploys only the controlled `sealproof-test` environment.

## Public configuration

- `EXPECTED_HOSTNAME`: exact custom hostname, without scheme or path
- workflow and two cryptographic key-version labels
- `RESEND_FROM`: address on the verified, restricted Resend sending domain
- D1 database name and ID, private R2 bucket name, asset directory, and the
  approved every-minute cleanup schedule

## Required secrets

- `TURNSTILE_SECRET_KEY`
- `KEY_ENCRYPTION_KEY_BASE64`
- `TICKET_ENCRYPTION_KEY_BASE64`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`

The PDF and finalization-ticket keys must be independent random 32-byte keys.
Their values must never be copied into this manifest,
source control, chat, logs, screenshots, or ordinary Cloudflare variables.

The manifest declares every secret as required so current Wrangler versions
refuse deployment when one is absent. Secret installation is a separate,
explicitly approved operation. Prefer version-scoped secret commands because
the ordinary `wrangler secret put` command creates and deploys a Worker version.

## Binding behavior

Every production API request validates the entire configuration before invoking
Turnstile, Resend, D1, or R2. Static assets may remain available during an API
configuration failure. Scheduled privacy cleanup deliberately depends only on
the D1 and R2 bindings: an email-secret problem must never prevent expired data
deletion.

## Remaining gate

Choose the exact production hostname, create or identify the D1 database and R2
bucket, replace and review both placeholders, apply migrations, then perform a
dry-run build. None of those actions are authorized by this document.

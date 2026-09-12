# Controlled Test Environment

## Address and isolation

- Application hostname: `test.sealproof.app`
- Turnstile widget: `SealProof Test`, managed mode, restricted to
  `test.sealproof.app`, pre-clearance off
- Public Turnstile site key: `0x4AAAAAAEugZnhz6_XrWjKi`
- Worker name: `sealproof-test`
- D1 database: `sealproof-test`
- D1 database ID: `5ab60654-c8a5-425b-83c9-0431eb75fa40`
- Private R2 bucket: `sealproof-test-documents`

These resources are separate from the existing `sealproof.app` homepage and
from every future production resource. Creation did not deploy a Worker, add the
custom hostname, apply a database migration, install a secret, or store data.

## Initial deployment prerequisites (historical)

`wrangler.test.jsonc` uses the project owner's confirmed sender,
`SealProof Releases <releases@sealproof.app>`, on the verified
`sealproof.app` domain. It declares five required secret names but contains none
of their values. Deployment is not approved until:

1. five test-environment secrets are generated or obtained through their
   respective services and installed without entering source control or chat;
2. Resend's webhook endpoint is configured as
   `https://test.sealproof.app/api/webhooks/resend`; and
3. a final Wrangler dry run reports the intended Worker, hostname, database,
   bucket, assets, schedule, variables, and required secret names.

The live-test deployment must happen as its own explicit checkpoint.

## Initial database preparation (historical)

All four migrations through `0004_encrypted_provider_ticket.sql` were applied
to the remote test database. A subsequent migration check reported nothing
pending. Aggregate read-only verification found zero audit releases, temporary
releases, delivery attempts, processed webhooks, and consumed admissions.

## September 12, 2026 validated baseline

The historical setup notes above do not describe the current migration level.
All migrations through `0008_delivery_budget.sql` are now applied remotely.
The current test deployment has `DELIVERY_ENABLED="false"`; its ten disabled
smoke checks passed. See the [combined validation record](../evidence/2026-09-12-disabled-test-validation.md)
for the exact version, SQL parser correction, rollback constraints, and the
remaining controlled live-test checklist. No live sends were made in that run.

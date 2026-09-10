# Controlled Test Environment

## Address and isolation

- Application hostname: `test.sealproof.app`
- Worker name: `sealproof-test`
- D1 database: `sealproof-test`
- D1 database ID: `5ab60654-c8a5-425b-83c9-0431eb75fa40`
- Private R2 bucket: `sealproof-test-documents`

These resources are separate from the existing `sealproof.app` homepage and
from every future production resource. Creation did not deploy a Worker, add the
custom hostname, apply a database migration, install a secret, or store data.

## Current deployment blockers

`wrangler.test.jsonc` intentionally retains the
`REPLACE_WITH_VERIFIED_RESEND_FROM_ADDRESS` placeholder. It declares six
required secret names but contains none of their values. Deployment is not
approved until:

1. the exact verified Resend sender address is confirmed;
2. the empty D1 database receives the reviewed migrations;
3. six test-environment secrets are generated or obtained through their
   respective services and installed without entering source control or chat;
4. Turnstile explicitly permits `test.sealproof.app`;
5. Resend's webhook endpoint is configured as
   `https://test.sealproof.app/api/webhooks/resend`; and
6. a final Wrangler dry run reports the intended Worker, hostname, database,
   bucket, assets, schedule, variables, and required secret names.

The live-test deployment must happen as its own explicit checkpoint.

# 0042 — Isolated Cloudflare Test Resources

## Decision

Use `test.sealproof.app` for controlled live testing while leaving the existing
`sealproof.app` homepage untouched. Test D1, R2, Worker, hostname, secrets, and
delivery configuration remain separate from future production resources.

## Evidence

After refreshing Wrangler's OAuth session, read-only inventory showed no D1
databases and no R2 buckets in the selected Cloudflare account. The project
owner explicitly approved creation of:

- D1 `sealproof-test` in WNAM, ID
  `5ab60654-c8a5-425b-83c9-0431eb75fa40`; and
- private R2 `sealproof-test-documents` with Standard storage class.

Wrangler declined automatic file edits, so the resulting test manifest was
written and reviewed locally. Neither resource contains application data.

## Next gate

The project owner confirmed `SealProof Releases <releases@sealproof.app>` on
the verified `sealproof.app` domain. Apply the reviewed migrations to the empty
test database. Do not install secrets, configure DNS, configure a webhook, or
deploy in this checkpoint.

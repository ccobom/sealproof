# 0009 — Retire provider-attachment runtime

- Date: September 11, 2026
- Status: Checkpoint one passed live; checkpoint two passed local validation

## Context

Decision 0007 replaced Resend attachment URLs with direct Base64 attachment content. The production router stopped mounting the provider-attachment route, and new delivery attempts stopped creating provider capability hashes or encrypted capability envelopes. The retired modules, key configuration, database columns, and tests nevertheless remained in the repository.

The repository's default `wrangler.jsonc` also continued to target an obsolete PDF spike. A bare `wrangler deploy` could therefore deploy that spike while appearing to be an application deployment. This happened during the 60 KB limit validation and was detected because an explicitly named `sealproof-test` tail received no traffic.

## Decision

Retirement is split into two checkpoints.

Checkpoint one removes the dormant provider capability, capability-storage, and HTTP-route modules; removes provider-key requirements from runtime configuration and fixtures; and removes the default deployable Wrangler configuration. Vitest receives a dedicated non-deployment configuration, while the controlled test environment is built and deployed through `npm.cmd run deploy:test`.

Checkpoint two begins only after the cleaned runtime passes its test deployment. It checks the remote database for non-null legacy provider-ticket or capability values, adds and applies a forward-only migration that removes the obsolete columns and validation objects, and then removes the unused Cloudflare secret. Historical migrations, decision records, and spike evidence remain unchanged.

## Consequences

The production runtime has fewer secret inputs, fewer dormant authorization primitives, and no retired document-retrieval handler. Explicit deployment targets reduce the chance of updating the wrong Worker. Removing the database columns is intentionally deferred so runtime deployment remains independently reversible and can be validated before the schema changes.

Historical files may continue to describe the superseded URL design. They are evidence of why the direct-content design was selected, not active implementation instructions.

## Checkpoint-one validation

The cleaned runtime passed 199 retained automated tests, the production build, and all Wrangler/TypeScript checks. The seven removed tests covered only the deleted provider-capability modules and route. A bare Wrangler dry run failed before deployment because no default deployable configuration exists, as intended.

The change was deployed explicitly to `sealproof-test` as Cloudflare Worker version `f9adf675-27b3-4eac-b518-a22a956e0626`. A complete photographed release then passed with every compact Worker log entry reporting `Ok`; both role-specific messages arrived; each downloaded PDF hash matched the sealed SHA-256; and explicit closeout/reset completed successfully. The legacy database columns and Cloudflare secret remained present throughout this checkpoint.

## Checkpoint-two preflight and local validation

Before creating the removal migration, a read-only query against the remote `sealproof-test` database returned zero rows with a non-null `provider_ticket_envelope` or `provider_capability_hash`. Migration `0007_remove_provider_attachment_state.sql` drops the legacy index and validation triggers before dropping those two empty columns; it does not edit the historical migrations that originally created them.

The complete seven-migration chain passed locally. The new schema test confirms that neither legacy column nor any associated index/trigger remains. The full migrated suite passed 42 test files and 200 tests, and all Wrangler-generated environment and TypeScript checks passed. Remote migration and Cloudflare secret deletion remain separate manual steps.

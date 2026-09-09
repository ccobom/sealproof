# 0006 — Local D1 Release-State Spike

- Date: September 8, 2026
- Result: Partial pass
- Related decision: `docs/decisions/0002-release-state-and-audit-data.md`

## Question

Can an explicit D1 migration enforce the approved separation between temporary operational data and the one-year minimal audit record while supporting independent delivery attempts, webhook idempotency, retry history, conflict handling, and cascading cleanup?

## Scope

The spike runs entirely in the local Workers test runtime with an isolated D1 database. It uses synthetic identifiers and encrypted-envelope placeholders. It creates no Cloudflare database and handles no real document, address, provider ID, or secret.

## Schema

Migration `migrations/0001_release_state.sql` creates:

- `audit_releases` for the bounded one-year audit fields;
- `temporary_releases` for encrypted email envelopes, capability hashes, the private R2 key, and expiry;
- `delivery_attempts` for independent production and signer attempt history;
- `processed_webhooks` for duplicate detection during the temporary window.

Closed SQL constraints reject unapproved release states, delivery states, roles, failure categories, closeout reasons, hash formats, and cleanup combinations. Foreign-key cascades remove delivery attempts and webhook identifiers when the temporary release row is deleted.

## Evidence

On September 8, 2026:

- all production, test, and browser TypeScript checks passed;
- all 33 tests across six files passed;
- one batched creation produced exactly one initial attempt for each role;
- duplicate `svix-id` insertion was rejected by a primary-key constraint;
- retry created a distinct numbered attempt tied to the same transaction and document hash;
- production and signer states remained independent and overall state was derived;
- late non-terminal events could not downgrade terminal outcomes;
- either order of contradictory terminal events produced `UNRESOLVED_CONFLICT`;
- the exact two-hour boundary was treated as expired;
- cleanup deletion cascaded through temporary delivery and webhook data;
- the retained row contained the approved audit fields and no plaintext-email, R2-key, capability, or provider-ID columns;
- invalid hashes and arbitrary failure text were rejected by SQL constraints.

## Remaining gate

This result does not yet prove the entire decision. Before acceptance, executable application code and tests must demonstrate:

- atomic duplicate-safe webhook insertion plus state application, rather than testing the uniqueness constraint alone;
- idempotent repeated cleanup;
- fail-safe recovery across the non-transactional R2/D1 cleanup boundary;
- integration of the validated encrypted-email envelope with the temporary row;
- automatic deletion of audit rows after the defined 365-day period.

## Conclusion

The proposed schema and pure state reducer pass their first local gate. No remote D1 resource is justified yet. Continue locally until the remaining transaction and cleanup behaviors have executable evidence.

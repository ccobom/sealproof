# 0008 — Local Cleanup and Recovery

- Date: September 8, 2026
- Result: Pass (local synthetic test)
- Related decision: `docs/decisions/0002-release-state-and-audit-data.md`

## Question

Can SealProof enforce the unconditional two-hour deletion boundary, invalidate temporary access before deletion, and recover safely when R2 and D1 cannot share a transaction?

## Scope

This spike uses the Cloudflare Workers local test runtime, a local Miniflare R2 bucket, local D1, synthetic encrypted-envelope placeholders, and synthetic PDF bytes. It creates or modifies no live Cloudflare resource and handles no real personal information.

## Cleanup sequence

`src/cleanup/release-cleanup.ts` performs cleanup in this order:

1. Set `cleanup_started_at` without changing an earlier value and record the bounded closeout reason.
2. Make temporary capability checks fail once cleanup has started or expiry has been reached.
3. Delete the private R2 object.
4. Confirm with R2 `head` that the object is absent.
5. In one D1 batch, delete the temporary release (cascading attempts and webhook receipts) and mark the audit row closed and complete.
6. Set audit expiry to exactly 365 days after confirmed cleanup.

R2 deletion is idempotent. If execution stops after R2 deletion but before D1 finalization, a retry uses the retained object key, confirms that the already-absent object remains absent, and completes D1. If R2 deletion fails, the temporary row remains for retry but `cleanup_started_at` keeps its capabilities invalid.

Cleanup failures retain only a constrained stage, timestamp, and approved failure category. Provider errors and exception messages are not written to D1.

## Evidence

On September 8, 2026:

- all 52 tests across nine files passed;
- all production, test, and browser TypeScript checks passed;
- explicit closeout removed the local R2 object, encrypted temporary row, delivery attempts, and webhook receipts before marking audit completion;
- an R2 failure immediately invalidated temporary access and retained only bounded failure metadata;
- retry after the synthetic R2 failure completed successfully;
- retry after a simulated interruption between R2 deletion and D1 finalization completed successfully;
- repeated cleanup returned success without moving the original cleanup or audit-expiry timestamps;
- automatic cleanup did not run one millisecond early and did run at the exact two-hour boundary;
- automatic expiry overrode pending/delayed delivery and retained `expired_delivery_unresolved`;
- an audit row survived until one millisecond before its deadline, was deleted at exactly 365 days, and remained absent on repeated deletion.

## Remaining gates

This test does not yet schedule a deployed Worker alarm or cron trigger. Before production:

- connect `cleanupExpiredReleases` and `deleteExpiredAuditRecords` to a reviewed scheduled Worker entry point;
- require every production status, download, and retry route to use the tested cleanup/expiry guard;
- ensure the schedule and batch size can meet the two-hour maximum under backlog and retry conditions;
- configure bounded operational alerting for repeated cleanup failure without logging PII;
- test cleanup once against dedicated non-production Cloudflare resources;
- integrate actual encrypted temporary release creation with this cleanup path.

## Conclusion

The local cleanup and cross-service recovery gate passes. The implementation fails closed: temporary access ends before external deletion begins, and audit completion is recorded only after R2 absence is confirmed and temporary D1 data is removed atomically.

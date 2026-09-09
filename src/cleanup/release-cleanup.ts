export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;

export type CleanupReason =
  | "production_closeout"
  | "download_and_delete"
  | "automatic_expiry";

export type CleanupResult =
  | { outcome: "completed" | "already_completed"; transactionId: string }
  | { outcome: "not_due" | "not_found"; transactionId: string }
  | { outcome: "failed"; transactionId: string; stage: "R2_DELETE_OR_CONFIRM" | "D1_FINALIZATION" };

interface CleanupTargetRow {
  r2_object_key: string;
}

interface AuditCleanupRow {
  cleanup_outcome: "PENDING" | "COMPLETED" | "FAILED";
}

function assertInput(transactionId: string, now: number): void {
  if (transactionId.length < 16 || transactionId.length > 128) {
    throw new Error("transactionId must contain between 16 and 128 characters");
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative safe integer");
  }
}

async function existingOutcome(
  db: D1Database,
  transactionId: string,
): Promise<CleanupResult> {
  const audit = await db.prepare(`
    SELECT cleanup_outcome FROM audit_releases WHERE transaction_id = ?
  `).bind(transactionId).first<AuditCleanupRow>();
  if (audit?.cleanup_outcome === "COMPLETED") {
    return { outcome: "already_completed", transactionId };
  }
  return { outcome: "not_found", transactionId };
}

async function recordFailure(
  db: D1Database,
  transactionId: string,
  stage: "R2_DELETE_OR_CONFIRM" | "D1_FINALIZATION",
  now: number,
): Promise<void> {
  await db.prepare(`
    UPDATE audit_releases SET
      cleanup_outcome = 'FAILED',
      failure_category = COALESCE(failure_category, 'cleanup_failed'),
      cleanup_failure_stage = ?,
      cleanup_failed_at = ?,
      cleanup_completed_at = NULL,
      audit_expires_at = NULL
    WHERE transaction_id = ? AND cleanup_outcome != 'COMPLETED'
  `).bind(stage, now, transactionId).run();
}

export async function cleanupRelease(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete" | "head">,
  transactionId: string,
  reason: CleanupReason,
  now: number,
): Promise<CleanupResult> {
  assertInput(transactionId, now);

  const dueCondition = reason === "automatic_expiry" ? "AND expires_at <= ?" : "";
  const startBindings: (string | number)[] = [now, transactionId];
  if (reason === "automatic_expiry") startBindings.push(now);

  const [startResult] = await db.batch<CleanupTargetRow>([
    db.prepare(`
      UPDATE temporary_releases
      SET cleanup_started_at = COALESCE(cleanup_started_at, ?)
      WHERE transaction_id = ? ${dueCondition}
      RETURNING r2_object_key
    `).bind(...startBindings),
    db.prepare(`
      UPDATE audit_releases
      SET
        closeout_reason = COALESCE(closeout_reason, ?),
        failure_category = CASE
          WHEN ? = 'automatic_expiry'
            AND release_state = 'SEALED_AWAITING_DELIVERY'
            THEN COALESCE(failure_category, 'expired_delivery_unresolved')
          ELSE failure_category
        END
      WHERE transaction_id = ?
        AND EXISTS (
          SELECT 1 FROM temporary_releases
          WHERE transaction_id = ? AND cleanup_started_at IS NOT NULL
        )
    `).bind(reason, reason, transactionId, transactionId),
  ]);

  const target = startResult.results[0];
  if (!target) {
    const existing = await existingOutcome(db, transactionId);
    if (existing.outcome === "already_completed" || existing.outcome === "not_found") {
      if (reason !== "automatic_expiry" || existing.outcome !== "not_found") return existing;
    }
    const temporary = await db.prepare(`
      SELECT 1 AS present FROM temporary_releases WHERE transaction_id = ?
    `).bind(transactionId).first();
    return temporary
      ? { outcome: "not_due", transactionId }
      : existing;
  }

  try {
    await bucket.delete(target.r2_object_key);
    const remaining = await bucket.head(target.r2_object_key);
    if (remaining !== null) throw new Error("R2 object still exists after deletion");
  } catch {
    await recordFailure(db, transactionId, "R2_DELETE_OR_CONFIRM", now);
    return { outcome: "failed", transactionId, stage: "R2_DELETE_OR_CONFIRM" };
  }

  const auditExpiresAt = now + AUDIT_RETENTION_MS;
  try {
    const results = await db.batch([
      db.prepare(`
        DELETE FROM temporary_releases WHERE transaction_id = ?
      `).bind(transactionId),
      db.prepare(`
        UPDATE audit_releases SET
          release_state = 'CLOSED',
          cleanup_outcome = 'COMPLETED',
          cleanup_completed_at = ?,
          audit_expires_at = ?
        WHERE transaction_id = ? AND cleanup_outcome != 'COMPLETED'
        RETURNING transaction_id
      `).bind(now, auditExpiresAt, transactionId),
    ]);
    return {
      outcome: results[1]?.meta.changes === 1 ? "completed" : "already_completed",
      transactionId,
    };
  } catch (error) {
    try {
      await recordFailure(db, transactionId, "D1_FINALIZATION", now);
    } catch {
      // The caller must retry. Do not conceal the database failure that also
      // prevented recording its bounded failure marker.
      throw error;
    }
    return { outcome: "failed", transactionId, stage: "D1_FINALIZATION" };
  }
}

export async function cleanupExpiredReleases(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete" | "head">,
  now: number,
  limit = 100,
): Promise<CleanupResult[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  const expired = await db.prepare(`
    SELECT transaction_id FROM temporary_releases
    WHERE expires_at <= ?
    ORDER BY expires_at ASC
    LIMIT ?
  `).bind(now, limit).all<{ transaction_id: string }>();

  const results: CleanupResult[] = [];
  for (const row of expired.results) {
    results.push(await cleanupRelease(
      db,
      bucket,
      row.transaction_id,
      "automatic_expiry",
      now,
    ));
  }
  return results;
}

export async function deleteExpiredAuditRecords(
  db: D1Database,
  now: number,
): Promise<number> {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative safe integer");
  }
  const result = await db.prepare(`
    DELETE FROM audit_releases
    WHERE audit_expires_at IS NOT NULL AND audit_expires_at <= ?
  `).bind(now).run();
  return result.meta.changes;
}

export async function temporaryAccessExists(
  db: D1Database,
  transactionId: string,
  capabilityHash: string,
  kind: "status" | "download",
  now: number,
): Promise<boolean> {
  const column = kind === "status" ? "status_capability_hash" : "download_capability_hash";
  const row = await db.prepare(`
    SELECT 1 AS allowed FROM temporary_releases tr
    JOIN audit_releases ar ON ar.transaction_id = tr.transaction_id
    WHERE tr.transaction_id = ? AND tr.${column} = ?
      AND tr.cleanup_started_at IS NULL AND tr.expires_at > ?
      AND (? = 'status' OR ar.release_state != 'FINALIZING')
  `).bind(transactionId, capabilityHash, now, kind).first();
  return row !== null;
}

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  AUDIT_RETENTION_MS,
  cleanupExpiredReleases,
  cleanupRelease,
  deleteExpiredAuditRecords,
  temporaryAccessExists,
} from "../../src/cleanup/release-cleanup";
import { sha256Hex } from "../../src/document/hash";

const FINALIZED_AT = 1_800_000_000_000;
const EXPIRES_AT = FINALIZED_AT + 7_200_000;

interface Fixture {
  transactionId: string;
  objectKey: string;
  statusHash: string;
  downloadHash: string;
}

async function createRelease(suffix: string, expiresAt = EXPIRES_AT): Promise<Fixture> {
  const transactionId = `transaction_cleanup_${suffix}`;
  const objectKey = `temporary/${transactionId}.pdf`;
  const statusHash = await sha256Hex(new TextEncoder().encode(`${transactionId}:status`));
  const downloadHash = await sha256Hex(new TextEncoder().encode(`${transactionId}:download`));

  await env.TEST_DB.batch([
    env.TEST_DB.prepare(`
      INSERT INTO audit_releases (
        transaction_id, document_hash, hash_algorithm, workflow_version,
        finalized_at, release_state
      ) VALUES (?, ?, 'SHA-256', 'test-v1', ?, 'SEALED_AWAITING_DELIVERY')
    `).bind(transactionId, "a".repeat(64), FINALIZED_AT),
    env.TEST_DB.prepare(`
      INSERT INTO temporary_releases (
        transaction_id, envelope_version, key_version, envelope_iv,
        email_ciphertext, wrapped_key_iv, wrapped_data_key, r2_object_key,
        status_capability_hash, download_capability_hash, expires_at
      ) VALUES (?, 1, 'v1', 'iv', 'ciphertext', 'key-iv', 'wrapped-key', ?, ?, ?, ?)
    `).bind(transactionId, objectKey, statusHash, downloadHash, expiresAt),
    env.TEST_DB.prepare(`
      INSERT INTO delivery_attempts (
        transaction_id, recipient_role, attempt_number, provider_message_id,
        delivery_state, created_at
      ) VALUES (?, 'PRODUCTION', 1, ?, 'ACCEPTED', ?)
    `).bind(transactionId, `${transactionId}-production`, FINALIZED_AT),
    env.TEST_DB.prepare(`
      INSERT INTO delivery_attempts (
        transaction_id, recipient_role, attempt_number, provider_message_id,
        delivery_state, created_at
      ) VALUES (?, 'SIGNER', 1, ?, 'DELAYED', ?)
    `).bind(transactionId, `${transactionId}-signer`, FINALIZED_AT),
  ]);
  await env.TEST_BUCKET.put(objectKey, new Uint8Array([1, 2, 3, 4]));
  return { transactionId, objectKey, statusHash, downloadHash };
}

describe("release cleanup", () => {
  it("deletes R2 and temporary D1 data before marking the audit complete", async () => {
    const fixture = await createRelease("explicit");
    const cleanedAt = FINALIZED_AT + 1_000;

    const result = await cleanupRelease(
      env.TEST_DB,
      env.TEST_BUCKET,
      fixture.transactionId,
      "production_closeout",
      cleanedAt,
    );

    expect(result.outcome).toBe("completed");
    expect(await env.TEST_BUCKET.head(fixture.objectKey)).toBeNull();
    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM temporary_releases WHERE transaction_id = ?
    `).bind(fixture.transactionId).first()).toBeNull();
    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM delivery_attempts WHERE transaction_id = ?
    `).bind(fixture.transactionId).first()).toBeNull();
    expect(await env.TEST_DB.prepare(`
      SELECT release_state, cleanup_outcome, closeout_reason,
        cleanup_completed_at, audit_expires_at
      FROM audit_releases WHERE transaction_id = ?
    `).bind(fixture.transactionId).first()).toEqual({
      release_state: "CLOSED",
      cleanup_outcome: "COMPLETED",
      closeout_reason: "production_closeout",
      cleanup_completed_at: cleanedAt,
      audit_expires_at: cleanedAt + AUDIT_RETENTION_MS,
    });
  });

  it("invalidates capabilities immediately and retains bounded failure data", async () => {
    const fixture = await createRelease("r2_failure");
    expect(await temporaryAccessExists(
      env.TEST_DB,
      fixture.transactionId,
      fixture.downloadHash,
      "download",
      FINALIZED_AT,
    )).toBe(true);

    const failingBucket: Pick<R2Bucket, "delete" | "head"> = {
      delete: async () => { throw new Error("synthetic private detail"); },
      head: (key) => env.TEST_BUCKET.head(key),
    };
    const failedAt = FINALIZED_AT + 2_000;
    const result = await cleanupRelease(
      env.TEST_DB,
      failingBucket,
      fixture.transactionId,
      "download_and_delete",
      failedAt,
    );

    expect(result).toEqual({
      outcome: "failed",
      transactionId: fixture.transactionId,
      stage: "R2_DELETE_OR_CONFIRM",
    });
    expect(await temporaryAccessExists(
      env.TEST_DB,
      fixture.transactionId,
      fixture.downloadHash,
      "download",
      failedAt,
    )).toBe(false);
    expect(await env.TEST_BUCKET.head(fixture.objectKey)).not.toBeNull();
    expect(await env.TEST_DB.prepare(`
      SELECT cleanup_outcome, failure_category, cleanup_failure_stage,
        cleanup_failed_at, cleanup_completed_at, audit_expires_at
      FROM audit_releases WHERE transaction_id = ?
    `).bind(fixture.transactionId).first()).toEqual({
      cleanup_outcome: "FAILED",
      failure_category: "cleanup_failed",
      cleanup_failure_stage: "R2_DELETE_OR_CONFIRM",
      cleanup_failed_at: failedAt,
      cleanup_completed_at: null,
      audit_expires_at: null,
    });

    await expect(cleanupRelease(
      env.TEST_DB,
      env.TEST_BUCKET,
      fixture.transactionId,
      "download_and_delete",
      failedAt + 1,
    )).resolves.toMatchObject({ outcome: "completed" });
  });

  it("recovers after interruption between R2 deletion and D1 finalization", async () => {
    const fixture = await createRelease("interrupted");
    const startedAt = FINALIZED_AT + 3_000;
    await env.TEST_DB.prepare(`
      UPDATE temporary_releases SET cleanup_started_at = ? WHERE transaction_id = ?
    `).bind(startedAt, fixture.transactionId).run();
    await env.TEST_DB.prepare(`
      UPDATE audit_releases SET closeout_reason = 'automatic_expiry'
      WHERE transaction_id = ?
    `).bind(fixture.transactionId).run();
    await env.TEST_BUCKET.delete(fixture.objectKey);

    const result = await cleanupRelease(
      env.TEST_DB,
      env.TEST_BUCKET,
      fixture.transactionId,
      "automatic_expiry",
      EXPIRES_AT,
    );
    expect(result.outcome).toBe("completed");
    expect(await env.TEST_DB.prepare(`
      SELECT cleanup_outcome FROM audit_releases WHERE transaction_id = ?
    `).bind(fixture.transactionId).first()).toEqual({ cleanup_outcome: "COMPLETED" });
  });

  it("is idempotent and does not move the original completion timestamps", async () => {
    const fixture = await createRelease("idempotent");
    const cleanedAt = FINALIZED_AT + 4_000;
    await cleanupRelease(
      env.TEST_DB,
      env.TEST_BUCKET,
      fixture.transactionId,
      "production_closeout",
      cleanedAt,
    );

    const repeated = await cleanupRelease(
      env.TEST_DB,
      env.TEST_BUCKET,
      fixture.transactionId,
      "production_closeout",
      cleanedAt + 50_000,
    );
    expect(repeated.outcome).toBe("already_completed");
    expect(await env.TEST_DB.prepare(`
      SELECT cleanup_completed_at, audit_expires_at FROM audit_releases
      WHERE transaction_id = ?
    `).bind(fixture.transactionId).first()).toEqual({
      cleanup_completed_at: cleanedAt,
      audit_expires_at: cleanedAt + AUDIT_RETENTION_MS,
    });
  });

  it("runs automatic cleanup at the exact expiry boundary regardless of delivery state", async () => {
    const fixture = await createRelease("automatic");

    await expect(cleanupExpiredReleases(
      env.TEST_DB,
      env.TEST_BUCKET,
      EXPIRES_AT - 1,
    )).resolves.toEqual([]);
    expect(await env.TEST_BUCKET.head(fixture.objectKey)).not.toBeNull();

    const results = await cleanupExpiredReleases(
      env.TEST_DB,
      env.TEST_BUCKET,
      EXPIRES_AT,
    );
    expect(results).toContainEqual({
      outcome: "completed",
      transactionId: fixture.transactionId,
    });
    expect(await env.TEST_BUCKET.head(fixture.objectKey)).toBeNull();
    expect(await env.TEST_DB.prepare(`
      SELECT closeout_reason, failure_category FROM audit_releases WHERE transaction_id = ?
    `).bind(fixture.transactionId).first()).toEqual({
      closeout_reason: "automatic_expiry",
      failure_category: "expired_delivery_unresolved",
    });
  });

  it("deletes the minimal audit at, but not before, its 365-day boundary", async () => {
    const fixture = await createRelease("audit_expiry");
    const cleanedAt = FINALIZED_AT + 5_000;
    await cleanupRelease(
      env.TEST_DB,
      env.TEST_BUCKET,
      fixture.transactionId,
      "production_closeout",
      cleanedAt,
    );
    const auditExpiresAt = cleanedAt + AUDIT_RETENTION_MS;

    await deleteExpiredAuditRecords(env.TEST_DB, auditExpiresAt - 1);
    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM audit_releases WHERE transaction_id = ?
    `).bind(fixture.transactionId).first()).not.toBeNull();
    await expect(deleteExpiredAuditRecords(env.TEST_DB, auditExpiresAt)).resolves.toBe(1);
    await expect(deleteExpiredAuditRecords(env.TEST_DB, auditExpiresAt)).resolves.toBe(0);
  });
});

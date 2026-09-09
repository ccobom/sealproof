import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/document/hash";
import { createReleaseState } from "../../src/release/release-state";

const FINALIZED_AT = 1_800_000_000_000;
const EXPIRES_AT = FINALIZED_AT + 7_200_000;
const HASH = "a".repeat(64);

async function createRelease(transactionId: string): Promise<void> {
  const statusHash = await sha256Hex(new TextEncoder().encode(`${transactionId}:status`));
  const downloadHash = await sha256Hex(new TextEncoder().encode(`${transactionId}:download`));
  await createReleaseState(env.TEST_DB, {
    transactionId,
    documentHash: HASH,
    workflowVersion: "test-v1",
    finalizedAt: FINALIZED_AT,
    documentSize: 4,
    r2ObjectKey: `synthetic/${transactionId}.pdf`,
    statusCapabilityHash: statusHash,
    downloadCapabilityHash: downloadHash,
    emailAddresses: {
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
    },
    keyVersion: "v1",
    keyEncryptionKey: new Uint8Array(32),
  });
}

describe("release database migration", () => {
  it("creates exactly one initial attempt for each recipient role", async () => {
    const transactionId = "transaction_db_roles";
    await createRelease(transactionId);

    const attempts = await env.TEST_DB.prepare(`
      SELECT recipient_role, attempt_number, delivery_state
      FROM delivery_attempts WHERE transaction_id = ? ORDER BY recipient_role
    `).bind(transactionId).all();

    expect(attempts.results).toEqual([
      { recipient_role: "PRODUCTION", attempt_number: 1, delivery_state: "PENDING_SUBMISSION" },
      { recipient_role: "SIGNER", attempt_number: 1, delivery_state: "PENDING_SUBMISSION" },
    ]);
  });

  it("rejects duplicate webhook identifiers", async () => {
    const transactionId = "transaction_db_webhook";
    await createRelease(transactionId);
    const attempt = await env.TEST_DB.prepare(`
      SELECT id FROM delivery_attempts
      WHERE transaction_id = ? AND recipient_role = 'PRODUCTION'
    `).bind(transactionId).first<{ id: number }>();
    expect(attempt).not.toBeNull();

    const insert = env.TEST_DB.prepare(`
      INSERT INTO processed_webhooks (
        svix_id, payload_hash, transaction_id, delivery_attempt_id, event_type, received_at
      ) VALUES ('webhook_duplicate', ?, ?, ?, 'email.sent', ?)
    `).bind("b".repeat(64), transactionId, attempt!.id, FINALIZED_AT);
    await insert.run();

    await expect(insert.run()).rejects.toThrow();
  });

  it("creates retry as a distinct attempt tied to the same document hash", async () => {
    const transactionId = "transaction_db_retry";
    await createRelease(transactionId);
    await env.TEST_DB.prepare(`
      INSERT INTO delivery_attempts (
        transaction_id, recipient_role, attempt_number, delivery_state, created_at
      ) VALUES (?, 'SIGNER', 2, 'PENDING_SUBMISSION', ?)
    `).bind(transactionId, FINALIZED_AT + 1).run();

    const row = await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS attempt_count, ar.document_hash
      FROM delivery_attempts da
      JOIN audit_releases ar ON ar.transaction_id = da.transaction_id
      WHERE da.transaction_id = ? AND da.recipient_role = 'SIGNER'
    `).bind(transactionId).first<{ attempt_count: number; document_hash: string }>();

    expect(row).toEqual({ attempt_count: 2, document_hash: HASH });
  });

  it("cleanup cascades temporary state while retaining only bounded audit fields", async () => {
    const transactionId = "transaction_db_cleanup";
    await createRelease(transactionId);
    const attempt = await env.TEST_DB.prepare(
      "SELECT id FROM delivery_attempts WHERE transaction_id = ? LIMIT 1",
    ).bind(transactionId).first<{ id: number }>();
    await env.TEST_DB.prepare(`
      INSERT INTO processed_webhooks (
        svix_id, payload_hash, transaction_id, delivery_attempt_id, event_type, received_at
      ) VALUES ('webhook_cleanup', ?, ?, ?, 'email.delivered', ?)
    `).bind("c".repeat(64), transactionId, attempt!.id, FINALIZED_AT).run();

    const cleanupAt = EXPIRES_AT;
    const auditExpiry = cleanupAt + 31_536_000_000;
    await env.TEST_DB.batch([
      env.TEST_DB.prepare("DELETE FROM temporary_releases WHERE transaction_id = ?").bind(transactionId),
      env.TEST_DB.prepare(`
        UPDATE audit_releases SET
          release_state = 'CLOSED', cleanup_outcome = 'COMPLETED',
          cleanup_completed_at = ?, audit_expires_at = ?, closeout_reason = 'automatic_expiry'
        WHERE transaction_id = ?
      `).bind(cleanupAt, auditExpiry, transactionId),
    ]);

    const temporary = await env.TEST_DB.prepare(
      "SELECT COUNT(*) AS count FROM temporary_releases WHERE transaction_id = ?",
    ).bind(transactionId).first<{ count: number }>();
    const attempts = await env.TEST_DB.prepare(
      "SELECT COUNT(*) AS count FROM delivery_attempts WHERE transaction_id = ?",
    ).bind(transactionId).first<{ count: number }>();
    const webhooks = await env.TEST_DB.prepare(
      "SELECT COUNT(*) AS count FROM processed_webhooks WHERE transaction_id = ?",
    ).bind(transactionId).first<{ count: number }>();
    const audit = await env.TEST_DB.prepare(
      "SELECT * FROM audit_releases WHERE transaction_id = ?",
    ).bind(transactionId).first<Record<string, unknown>>();

    expect(temporary?.count).toBe(0);
    expect(attempts?.count).toBe(0);
    expect(webhooks?.count).toBe(0);
    expect(audit).toMatchObject({
      transaction_id: transactionId,
      document_hash: HASH,
      release_state: "CLOSED",
      cleanup_outcome: "COMPLETED",
      audit_expires_at: auditExpiry,
    });
    expect(Object.keys(audit ?? {})).not.toEqual(expect.arrayContaining([
      "production_email",
      "signer_email",
      "r2_object_key",
      "provider_message_id",
    ]));
  });

  it("rejects values outside closed enums and hash constraints", async () => {
    await expect(env.TEST_DB.prepare(`
      INSERT INTO audit_releases (
        transaction_id, document_hash, hash_algorithm, workflow_version,
        finalized_at, release_state, failure_category
      ) VALUES ('transaction_db_invalid', 'not-a-hash', 'SHA-256', 'test-v1', ?,
        'CLOSED', 'raw provider error text')
    `).bind(FINALIZED_AT).run()).rejects.toThrow();
  });
});

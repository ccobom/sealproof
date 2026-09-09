import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { AUDIT_RETENTION_MS } from "../../src/cleanup/release-cleanup";
import { runScheduledMaintenance } from "../../src/cleanup/scheduled-maintenance";
import { sha256Hex } from "../../src/document/hash";
import { MAXIMUM_TEMPORARY_RETENTION_MS } from "../../src/delivery/state";
import { finalizeRelease } from "../../src/release/finalize-release";

const NOW = 1_800_000_000_000;
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index);

async function createRelease(finalizedAt: number) {
  const document = await PDFDocument.create();
  document.addPage();
  const pdfBytes = await document.save();
  const result = await finalizeRelease(env.TEST_DB, env.TEST_BUCKET, {
    pdfBytes,
    browserDocumentHash: await sha256Hex(pdfBytes),
    workflowVersion: "scheduled-test-v1",
    emailAddresses: {
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
    },
    keyVersion: "scheduled-test-key-v1",
    keyEncryptionKey: KEY,
  }, () => finalizedAt);
  if (result.outcome !== "sealed" && result.outcome !== "pending_recovery") {
    throw new Error("Could not create scheduled-maintenance fixture");
  }
  return result;
}

describe("scheduled privacy maintenance", () => {
  it("cleans releases at the exact access-expiry boundary and leaves newer releases active", async () => {
    const expired = await createRelease(NOW - MAXIMUM_TEMPORARY_RETENTION_MS);
    const active = await createRelease(NOW);

    const summary = await runScheduledMaintenance({
      RELEASE_DB: env.TEST_DB,
      RELEASE_DOCUMENTS: env.TEST_BUCKET,
    }, NOW);

    expect(summary).toMatchObject({
      releasesExamined: 1,
      releasesCompleted: 1,
      releasesFailed: 0,
      releasesSkipped: 0,
      auditRecordsDeleted: 0,
    });
    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM temporary_releases WHERE transaction_id = ?
    `).bind(expired.transactionId).first()).toBeNull();
    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM temporary_releases WHERE transaction_id = ?
    `).bind(active.transactionId).first()).not.toBeNull();
  });

  it("deletes minimal audit rows at their independent one-year deadline", async () => {
    const transactionId = "scheduled_audit_expiry_record";
    await env.TEST_DB.prepare(`
      INSERT INTO audit_releases (
        transaction_id, document_hash, hash_algorithm, workflow_version,
        finalized_at, release_state, closeout_reason, cleanup_outcome,
        cleanup_completed_at, audit_expires_at
      ) VALUES (?, ?, 'SHA-256', 'scheduled-test-v1', ?, 'CLOSED',
        'production_closeout', 'COMPLETED', ?, ?)
    `).bind(
      transactionId,
      "a".repeat(64),
      NOW - AUDIT_RETENTION_MS,
      NOW - AUDIT_RETENTION_MS,
      NOW,
    ).run();

    const summary = await runScheduledMaintenance({
      RELEASE_DB: env.TEST_DB,
      RELEASE_DOCUMENTS: env.TEST_BUCKET,
    }, NOW);
    expect(summary.auditRecordsDeleted).toBe(1);
    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM audit_releases WHERE transaction_id = ?
    `).bind(transactionId).first()).toBeNull();
  });
});

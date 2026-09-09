import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { temporaryAccessExists } from "../../src/cleanup/release-cleanup";
import { bytesToHex, sha256Bytes, sha256Hex } from "../../src/document/hash";
import {
  finalizeRelease,
  resumeReleaseFinalization,
  type FinalizeReleaseInput,
} from "../../src/release/finalize-release";
import { createReleaseState } from "../../src/release/release-state";

const FINALIZED_AT = 1_800_000_000_000;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nsynthetic final document\n%%EOF");

function encryptionKey(): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => index);
}

async function finalizationInput(
  overrides: Partial<FinalizeReleaseInput> = {},
): Promise<FinalizeReleaseInput> {
  return {
    pdfBytes: PDF_BYTES,
    browserDocumentHash: await sha256Hex(PDF_BYTES),
    maximumPdfBytes: 1_000_000,
    workflowVersion: "test-v1",
    emailAddresses: {
      productionEmail: "producer@example.invalid",
      signerEmail: "signer@example.invalid",
    },
    keyVersion: "kek-v1",
    keyEncryptionKey: encryptionKey(),
    ...overrides,
  };
}

describe("release finalization coordinator", () => {
  it("seals only after independent hashing and checksum-validated R2 storage", async () => {
    const result = await finalizeRelease(
      env.TEST_DB,
      env.TEST_BUCKET,
      await finalizationInput(),
      () => FINALIZED_AT,
    );
    expect(result.outcome).toBe("sealed");
    if (result.outcome !== "sealed") throw new Error("Expected sealed result");

    const stored = await env.TEST_DB.prepare(`
      SELECT ar.release_state, ar.document_hash, tr.document_size,
        tr.r2_object_key, tr.status_capability_hash, tr.download_capability_hash
      FROM audit_releases ar
      JOIN temporary_releases tr ON tr.transaction_id = ar.transaction_id
      WHERE ar.transaction_id = ?
    `).bind(result.transactionId).first<Record<string, unknown>>();
    expect(stored).toMatchObject({
      release_state: "SEALED_AWAITING_DELIVERY",
      document_hash: result.documentHash,
      document_size: PDF_BYTES.byteLength,
    });
    expect(stored?.status_capability_hash).toBe(await sha256Hex(
      new TextEncoder().encode(result.statusCapability),
    ));
    expect(stored?.download_capability_hash).toBe(await sha256Hex(
      new TextEncoder().encode(result.downloadCapability),
    ));

    const object = await env.TEST_BUCKET.head(String(stored?.r2_object_key));
    expect(object?.size).toBe(PDF_BYTES.byteLength);
    expect(object?.checksums.sha256).toBeDefined();
    expect(bytesToHex(new Uint8Array(object!.checksums.sha256!))).toBe(result.documentHash);
  });

  it("rejects invalid, oversized, and hash-mismatched input before durable state", async () => {
    const before = await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM audit_releases
    `).first<{ count: number }>();

    await expect(finalizeRelease(env.TEST_DB, env.TEST_BUCKET, await finalizationInput({
      pdfBytes: new TextEncoder().encode("not a PDF"),
      browserDocumentHash: await sha256Hex(new TextEncoder().encode("not a PDF")),
    }), () => FINALIZED_AT)).resolves.toEqual({ outcome: "rejected", reason: "INVALID_PDF" });
    await expect(finalizeRelease(env.TEST_DB, env.TEST_BUCKET, await finalizationInput({
      maximumPdfBytes: PDF_BYTES.byteLength - 1,
    }), () => FINALIZED_AT)).resolves.toEqual({ outcome: "rejected", reason: "PDF_TOO_LARGE" });
    await expect(finalizeRelease(env.TEST_DB, env.TEST_BUCKET, await finalizationInput({
      browserDocumentHash: "0".repeat(64),
    }), () => FINALIZED_AT)).resolves.toEqual({ outcome: "rejected", reason: "HASH_MISMATCH" });

    const after = await env.TEST_DB.prepare(`
      SELECT COUNT(*) AS count FROM audit_releases
    `).first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
  });

  it("removes FINALIZING state after a definite R2 storage failure", async () => {
    const failingBucket: Pick<R2Bucket, "put" | "head" | "delete"> = {
      put: async () => { throw new Error("synthetic storage failure"); },
      head: async () => null,
      delete: async () => undefined,
    };
    const result = await finalizeRelease(
      env.TEST_DB,
      failingBucket,
      await finalizationInput(),
      () => FINALIZED_AT,
    );
    expect(result.outcome).toBe("storage_failed_cleaned");
    if (result.outcome !== "storage_failed_cleaned") throw new Error("Expected cleanup");

    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM audit_releases WHERE transaction_id = ?
    `).bind(result.transactionId).first()).toBeNull();
    expect(await env.TEST_DB.prepare(`
      SELECT 1 FROM temporary_releases WHERE transaction_id = ?
    `).bind(result.transactionId).first()).toBeNull();
  });

  it("does not seal if the Worker reaches expiry during storage", async () => {
    const times = [FINALIZED_AT, FINALIZED_AT + 7_200_000];
    const result = await finalizeRelease(
      env.TEST_DB,
      env.TEST_BUCKET,
      await finalizationInput(),
      () => times.shift() ?? FINALIZED_AT + 7_200_000,
    );
    expect(result.outcome).toBe("pending_recovery");
    if (result.outcome !== "pending_recovery") throw new Error("Expected pending recovery");

    expect(await env.TEST_DB.prepare(`
      SELECT release_state FROM audit_releases WHERE transaction_id = ?
    `).bind(result.transactionId).first()).toEqual({ release_state: "FINALIZING" });
    expect(await temporaryAccessExists(
      env.TEST_DB,
      result.transactionId,
      await sha256Hex(new TextEncoder().encode(result.downloadCapability)),
      "download",
      FINALIZED_AT + 7_200_000,
    )).toBe(false);
  });

  it("recovers an interrupted seal from R2 checksum metadata", async () => {
    const transactionId = "transaction_finalize_resume";
    const objectKey = `temporary/${transactionId}.pdf`;
    const statusCapability = "synthetic-status-capability";
    const downloadCapability = "synthetic-download-capability";
    const statusHash = await sha256Hex(new TextEncoder().encode(statusCapability));
    const downloadHash = await sha256Hex(new TextEncoder().encode(downloadCapability));
    const digest = await sha256Bytes(PDF_BYTES);
    const documentHash = bytesToHex(digest);
    await createReleaseState(env.TEST_DB, {
      transactionId,
      documentHash,
      workflowVersion: "test-v1",
      finalizedAt: FINALIZED_AT,
      documentSize: PDF_BYTES.byteLength,
      r2ObjectKey: objectKey,
      statusCapabilityHash: statusHash,
      downloadCapabilityHash: downloadHash,
      emailAddresses: {
        productionEmail: "producer@example.invalid",
        signerEmail: "signer@example.invalid",
      },
      keyVersion: "kek-v1",
      keyEncryptionKey: encryptionKey(),
    });
    await env.TEST_BUCKET.put(objectKey, PDF_BYTES, {
      sha256: digest.buffer as ArrayBuffer,
    });

    expect(await temporaryAccessExists(
      env.TEST_DB, transactionId, statusHash, "status", FINALIZED_AT,
    )).toBe(true);
    expect(await temporaryAccessExists(
      env.TEST_DB, transactionId, downloadHash, "download", FINALIZED_AT,
    )).toBe(false);

    await expect(resumeReleaseFinalization(
      env.TEST_DB,
      env.TEST_BUCKET,
      transactionId,
      FINALIZED_AT + 1,
    )).resolves.toEqual({ outcome: "sealed", transactionId });
    expect(await temporaryAccessExists(
      env.TEST_DB, transactionId, downloadHash, "download", FINALIZED_AT + 1,
    )).toBe(true);
    await expect(resumeReleaseFinalization(
      env.TEST_DB,
      env.TEST_BUCKET,
      transactionId,
      FINALIZED_AT + 2,
    )).resolves.toEqual({ outcome: "already_sealed", transactionId });
  });

  it("never seals a recovery object with missing or mismatched integrity metadata", async () => {
    for (const suffix of ["missing", "mismatch"] as const) {
      const transactionId = `transaction_finalize_${suffix}`;
      const objectKey = `temporary/${transactionId}.pdf`;
      await createReleaseState(env.TEST_DB, {
        transactionId,
        documentHash: await sha256Hex(PDF_BYTES),
        workflowVersion: "test-v1",
        finalizedAt: FINALIZED_AT,
        documentSize: PDF_BYTES.byteLength,
        r2ObjectKey: objectKey,
        statusCapabilityHash: await sha256Hex(new TextEncoder().encode(`${suffix}:status`)),
        downloadCapabilityHash: await sha256Hex(new TextEncoder().encode(`${suffix}:download`)),
        emailAddresses: {
          productionEmail: "producer@example.invalid",
          signerEmail: "signer@example.invalid",
        },
        keyVersion: "kek-v1",
        keyEncryptionKey: encryptionKey(),
      });
      if (suffix === "mismatch") {
        await env.TEST_BUCKET.put(objectKey, PDF_BYTES);
      }

      await expect(resumeReleaseFinalization(
        env.TEST_DB,
        env.TEST_BUCKET,
        transactionId,
        FINALIZED_AT + 1,
      )).resolves.toEqual({
        outcome: suffix === "missing" ? "waiting_for_pdf" : "integrity_failure",
        transactionId,
      });
      expect(await env.TEST_DB.prepare(`
        SELECT release_state FROM audit_releases WHERE transaction_id = ?
      `).bind(transactionId).first()).toEqual({ release_state: "FINALIZING" });
    }
  });
});

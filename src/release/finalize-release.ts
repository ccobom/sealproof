import type { TemporaryEmailAddresses } from "../crypto/temporary-pii";
import { bytesToHex, sha256Bytes } from "../document/hash";
import { validatePdfUpload, type PdfUploadFailure } from "../document/pdf-contract";
import { encryptTemporaryPdf } from "../crypto/temporary-pdf";
import {
  createReleaseState,
  markReleaseSealed,
} from "./release-state";

export interface FinalizeReleaseInput {
  admissionId?: string;
  pdfBytes: Uint8Array;
  browserDocumentHash: string;
  workflowVersion: string;
  emailAddresses: TemporaryEmailAddresses;
  keyVersion: string;
  keyEncryptionKey: Uint8Array;
}

interface FinalizationCredentials {
  transactionId: string;
  r2ObjectKey: string;
  statusCapability: string;
  statusCapabilityHash: string;
  downloadCapability: string;
  downloadCapabilityHash: string;
}

export type FinalizeReleaseResult =
  | {
      outcome: "sealed" | "pending_recovery";
      transactionId: string;
      documentHash: string;
      expiresAt: number;
      statusCapability: string;
      downloadCapability: string;
    }
  | { outcome: "rejected"; reason: PdfUploadFailure | "HASH_MISMATCH" | "ADMISSION_REPLAYED" }
  | { outcome: "storage_failed_cleaned"; transactionId: string };

export type ResumeFinalizationResult =
  | { outcome: "sealed" | "already_sealed"; transactionId: string }
  | { outcome: "waiting_for_pdf" | "integrity_failure" | "not_resumable"; transactionId: string };

interface FinalizingRow {
  release_state: string;
  document_hash: string;
  document_size: number;
  r2_object_key: string;
  cleanup_started_at: number | null;
  expires_at: number;
  storage_format: string;
  stored_ciphertext_size: number;
  stored_ciphertext_hash: string;
}

function randomCapability(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function createCredentials(): Promise<FinalizationCredentials> {
  const transactionId = crypto.randomUUID();
  const statusCapability = randomCapability();
  const downloadCapability = randomCapability();
  return {
    transactionId,
    r2ObjectKey: `temporary/${transactionId}.pdf.enc`,
    statusCapability,
    statusCapabilityHash: bytesToHex(await sha256Bytes(
      new TextEncoder().encode(statusCapability),
    )),
    downloadCapability,
    downloadCapabilityHash: bytesToHex(await sha256Bytes(
      new TextEncoder().encode(downloadCapability),
    )),
  };
}

function checksumMatches(object: R2Object, expectedHash: string): boolean {
  const checksum = object.checksums.sha256;
  return checksum !== undefined
    && bytesToHex(new Uint8Array(checksum)) === expectedHash;
}

async function discardFinalizingState(
  db: D1Database,
  transactionId: string,
): Promise<void> {
  await db.prepare(`
    DELETE FROM audit_releases
    WHERE transaction_id = ? AND release_state = 'FINALIZING'
  `).bind(transactionId).run();
}

function activeResult(
  outcome: "sealed" | "pending_recovery",
  credentials: FinalizationCredentials,
  documentHash: string,
  expiresAt: number,
): FinalizeReleaseResult {
  return {
    outcome,
    transactionId: credentials.transactionId,
    documentHash,
    expiresAt,
    statusCapability: credentials.statusCapability,
    downloadCapability: credentials.downloadCapability,
  };
}

export async function finalizeRelease(
  db: D1Database,
  bucket: Pick<R2Bucket, "put" | "head" | "delete">,
  input: FinalizeReleaseInput,
  now: () => number = Date.now,
): Promise<FinalizeReleaseResult> {
  const pdfBytes = new Uint8Array(input.pdfBytes);
  const contract = validatePdfUpload(pdfBytes);
  if (!contract.valid) return { outcome: "rejected", reason: contract.reason };
  const digest = await sha256Bytes(pdfBytes);
  const documentHash = bytesToHex(digest);
  if (input.browserDocumentHash !== documentHash) {
    return { outcome: "rejected", reason: "HASH_MISMATCH" };
  }

  const finalizedAt = now();
  if (!Number.isSafeInteger(finalizedAt) || finalizedAt < 0) {
    throw new Error("Worker clock returned an invalid timestamp");
  }
  const credentials = await createCredentials();
  const encryptedPdf = await encryptTemporaryPdf(
    pdfBytes,
    credentials.transactionId,
    documentHash,
    input.keyVersion,
    input.keyEncryptionKey,
  );
  const ciphertextDigest = await sha256Bytes(encryptedPdf.ciphertext);
  const ciphertextHash = bytesToHex(ciphertextDigest);
  let created;
  try {
    created = await createReleaseState(db, {
      admissionId: input.admissionId,
      transactionId: credentials.transactionId,
      documentHash,
      workflowVersion: input.workflowVersion,
      finalizedAt,
      documentSize: pdfBytes.byteLength,
      r2ObjectKey: credentials.r2ObjectKey,
      statusCapabilityHash: credentials.statusCapabilityHash,
      downloadCapabilityHash: credentials.downloadCapabilityHash,
      emailAddresses: input.emailAddresses,
      keyVersion: input.keyVersion,
      keyEncryptionKey: input.keyEncryptionKey,
      encryptedPdf: {
        metadata: encryptedPdf.metadata,
        ciphertextSize: encryptedPdf.ciphertext.byteLength,
        ciphertextHash,
      },
    });
  } catch (error) {
    if (input.admissionId) {
      const consumed = await db.prepare(`
        SELECT 1 AS consumed FROM consumed_admissions WHERE admission_id = ?
      `).bind(input.admissionId).first();
      if (consumed) return { outcome: "rejected", reason: "ADMISSION_REPLAYED" };
    }
    throw error;
  }

  let stored: R2Object | null;
  try {
    stored = await bucket.put(credentials.r2ObjectKey, encryptedPdf.ciphertext, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: ciphertextDigest.buffer as ArrayBuffer,
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: {
        transactionId: credentials.transactionId,
        storageFormat: "ENCRYPTED_V1",
      },
    });
  } catch {
    try {
      const maybeStored = await bucket.head(credentials.r2ObjectKey);
      if (maybeStored !== null) {
        return activeResult("pending_recovery", credentials, documentHash, created.expiresAt);
      }
      await discardFinalizingState(db, credentials.transactionId);
      return { outcome: "storage_failed_cleaned", transactionId: credentials.transactionId };
    } catch {
      return activeResult("pending_recovery", credentials, documentHash, created.expiresAt);
    }
  }

  if (stored === null) {
    await discardFinalizingState(db, credentials.transactionId);
    return { outcome: "storage_failed_cleaned", transactionId: credentials.transactionId };
  }
  if (stored.size !== encryptedPdf.ciphertext.byteLength || !checksumMatches(stored, ciphertextHash)) {
    try {
      await bucket.delete(credentials.r2ObjectKey);
      if (await bucket.head(credentials.r2ObjectKey) === null) {
        await discardFinalizingState(db, credentials.transactionId);
        return { outcome: "storage_failed_cleaned", transactionId: credentials.transactionId };
      }
    } catch {
      // Leave FINALIZING state for bounded recovery/expiry; never claim sealed.
    }
    return activeResult("pending_recovery", credentials, documentHash, created.expiresAt);
  }

  try {
    const sealedAt = now();
    if (!Number.isSafeInteger(sealedAt) || sealedAt < 0) {
      throw new Error("Worker clock returned an invalid timestamp");
    }
    const sealed = await markReleaseSealed(db, credentials.transactionId, sealedAt);
    return activeResult(
      sealed ? "sealed" : "pending_recovery",
      credentials,
      documentHash,
      created.expiresAt,
    );
  } catch {
    return activeResult("pending_recovery", credentials, documentHash, created.expiresAt);
  }
}

export async function resumeReleaseFinalization(
  db: D1Database,
  bucket: Pick<R2Bucket, "head">,
  transactionId: string,
  now: number,
): Promise<ResumeFinalizationResult> {
  const row = await db.prepare(`
    SELECT ar.release_state, ar.document_hash, tr.document_size, tr.r2_object_key,
      tr.cleanup_started_at, tr.expires_at, tr.storage_format,
      tr.stored_ciphertext_size, tr.stored_ciphertext_hash
    FROM audit_releases ar
    JOIN temporary_releases tr ON tr.transaction_id = ar.transaction_id
    WHERE ar.transaction_id = ?
  `).bind(transactionId).first<FinalizingRow>();

  if (!row || row.cleanup_started_at !== null || now >= row.expires_at) {
    return { outcome: "not_resumable", transactionId };
  }
  if (row.release_state === "SEALED_AWAITING_DELIVERY") {
    return { outcome: "already_sealed", transactionId };
  }
  if (row.release_state !== "FINALIZING" || row.storage_format !== "ENCRYPTED_V1") {
    return { outcome: "not_resumable", transactionId };
  }

  const object = await bucket.head(row.r2_object_key);
  if (object === null) return { outcome: "waiting_for_pdf", transactionId };
  if (object.size !== row.stored_ciphertext_size || !checksumMatches(object, row.stored_ciphertext_hash)) {
    return { outcome: "integrity_failure", transactionId };
  }

  const sealed = await markReleaseSealed(db, transactionId, now);
  return { outcome: sealed ? "sealed" : "not_resumable", transactionId };
}

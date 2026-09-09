import type { TemporaryEmailAddresses } from "../crypto/temporary-pii";
import { bytesToHex, sha256Bytes } from "../document/hash";
import {
  createReleaseState,
  markReleaseSealed,
} from "./release-state";

export interface FinalizeReleaseInput {
  pdfBytes: Uint8Array;
  browserDocumentHash: string;
  maximumPdfBytes: number;
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
  | { outcome: "rejected"; reason: "INVALID_PDF" | "HASH_MISMATCH" | "PDF_TOO_LARGE" }
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
    r2ObjectKey: `temporary/${transactionId}.pdf`,
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

function validPdfHeader(bytes: Uint8Array): boolean {
  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  return header === "%PDF-";
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
  if (!Number.isSafeInteger(input.maximumPdfBytes) || input.maximumPdfBytes < 1) {
    throw new Error("maximumPdfBytes must be a positive safe integer");
  }
  if (input.pdfBytes.byteLength > input.maximumPdfBytes) {
    return { outcome: "rejected", reason: "PDF_TOO_LARGE" };
  }
  if (!validPdfHeader(input.pdfBytes)) {
    return { outcome: "rejected", reason: "INVALID_PDF" };
  }

  const pdfBytes = new Uint8Array(input.pdfBytes);
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
  const created = await createReleaseState(db, {
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
  });

  let stored: R2Object | null;
  try {
    stored = await bucket.put(credentials.r2ObjectKey, pdfBytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: digest.buffer as ArrayBuffer,
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: {
        transactionId: credentials.transactionId,
        documentHash,
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
  if (stored.size !== pdfBytes.byteLength || !checksumMatches(stored, documentHash)) {
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
      tr.cleanup_started_at, tr.expires_at
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
  if (row.release_state !== "FINALIZING") {
    return { outcome: "not_resumable", transactionId };
  }

  const object = await bucket.head(row.r2_object_key);
  if (object === null) return { outcome: "waiting_for_pdf", transactionId };
  if (object.size !== row.document_size || !checksumMatches(object, row.document_hash)) {
    return { outcome: "integrity_failure", transactionId };
  }

  const sealed = await markReleaseSealed(db, transactionId, now);
  return { outcome: sealed ? "sealed" : "not_resumable", transactionId };
}

import { budgetExhausted } from "./delivery-budget";
import type { KeyEncryptionKeys } from "../crypto/temporary-pii";
import { decryptTemporaryPdf, type EncryptedTemporaryPdfMetadata } from "../crypto/temporary-pdf";
import { bytesToBase64 } from "../document/base64";
import { sha256Hex } from "../document/hash";
import { loadTemporaryEmailAddresses } from "../release/release-state";
import type { DeliveryProvider, DeliveryRecipientRole } from "./delivery-provider";
import { ResendDeliveryError } from "./resend-delivery-provider";

interface PendingAttemptRow {
  id: number;
  recipient_role: DeliveryRecipientRole;
  attempt_number: number;
  document_hash: string;
  expires_at: number;
  document_size: number;
  r2_object_key: string;
  storage_format: string;
  pdf_envelope_version: number;
  pdf_key_version: string;
  pdf_document_iv: string;
  pdf_wrapped_key_iv: string;
  pdf_wrapped_data_key: string;
  stored_ciphertext_size: number;
  stored_ciphertext_hash: string;
}

export interface PendingDeliveryDependencies {
  provider: DeliveryProvider;
  documents: R2Bucket;
  keyEncryptionKeys: KeyEncryptionKeys;
}

export interface PendingDeliveryResult {
  submitted: DeliveryRecipientRole[];
  alreadySubmitted: DeliveryRecipientRole[];
  failed: DeliveryRecipientRole[];
}

export type SubmissionFailureCategory =
  | "attachment_preparation_failed"
  | "provider_authentication"
  | "provider_invalid_request"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_malformed_response"
  | "provider_submission_failed";

function submissionFailureCategory(
  error: unknown,
  providerSubmissionStarted: boolean,
): SubmissionFailureCategory {
  if (!providerSubmissionStarted) return "attachment_preparation_failed";
  if (!(error instanceof ResendDeliveryError)) return "provider_submission_failed";
  if (error.category === "AUTHENTICATION") return "provider_authentication";
  if (error.category === "INVALID_REQUEST") return "provider_invalid_request";
  if (error.category === "RATE_LIMITED") return "provider_rate_limited";
  if (error.category === "PROVIDER_UNAVAILABLE") return "provider_unavailable";
  return "provider_malformed_response";
}

function idempotencyKey(
  transactionId: string,
  role: DeliveryRecipientRole,
  attemptNumber: number,
): string {
  return `sealproof/${transactionId}/${role.toLowerCase()}/${attemptNumber}`;
}

export async function submitPendingDeliveries(
  db: D1Database,
  transactionId: string,
  dependencies: PendingDeliveryDependencies,
  now: number = Date.now(),
): Promise<PendingDeliveryResult> {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid submission timestamp");
  const result: PendingDeliveryResult = { submitted: [], alreadySubmitted: [], failed: [] };
  const existing = await db.prepare(`
    SELECT recipient_role FROM delivery_attempts
    WHERE transaction_id = ? AND provider_message_id IS NOT NULL
  `).bind(transactionId).all<{ recipient_role: DeliveryRecipientRole }>();
  result.alreadySubmitted.push(...existing.results.map((row) => row.recipient_role));

  const attempts = await db.prepare(`
    SELECT da.id, da.recipient_role, da.attempt_number,
      ar.document_hash, tr.expires_at, tr.document_size, tr.r2_object_key,
      tr.storage_format, tr.pdf_envelope_version, tr.pdf_key_version,
      tr.pdf_document_iv, tr.pdf_wrapped_key_iv, tr.pdf_wrapped_data_key,
      tr.stored_ciphertext_size, tr.stored_ciphertext_hash
    FROM delivery_attempts da
    JOIN temporary_releases tr ON tr.transaction_id = da.transaction_id
    JOIN audit_releases ar ON ar.transaction_id = da.transaction_id
    WHERE da.transaction_id = ? AND da.delivery_state = 'PENDING_SUBMISSION'
      AND da.provider_message_id IS NULL AND tr.cleanup_started_at IS NULL
      AND tr.expires_at > ?
      AND ar.release_state IN ('SEALED_AWAITING_DELIVERY', 'DELIVERY_FAILED')
    ORDER BY da.id
  `).bind(transactionId, now).all<PendingAttemptRow>();
  if (attempts.results.length === 0) return result;

  const addresses = await loadTemporaryEmailAddresses(
    db, transactionId, dependencies.keyEncryptionKeys, now,
  );
  if (!addresses) return result;

  const document = attempts.results[0];
  let pdfBytes: Uint8Array;
  let ciphertext: Uint8Array | undefined;
  try {
    if (document.storage_format !== "ENCRYPTED_V1" || document.pdf_envelope_version !== 1) {
      throw new Error("Unsupported temporary PDF format");
    }
    const object = await dependencies.documents.get(document.r2_object_key);
    if (!object) throw new Error("Temporary PDF is unavailable");
    ciphertext = new Uint8Array(await object.arrayBuffer());
    if (ciphertext.byteLength !== document.stored_ciphertext_size
      || await sha256Hex(ciphertext) !== document.stored_ciphertext_hash) {
      throw new Error("Temporary PDF ciphertext failed integrity validation");
    }
    const metadata: EncryptedTemporaryPdfMetadata = {
      version: 1,
      keyVersion: document.pdf_key_version,
      documentIv: document.pdf_document_iv,
      wrappedKeyIv: document.pdf_wrapped_key_iv,
      wrappedKey: document.pdf_wrapped_data_key,
      plaintextBytes: document.document_size,
    };
    pdfBytes = await decryptTemporaryPdf(
      ciphertext, metadata, transactionId, document.document_hash,
      dependencies.keyEncryptionKeys,
    );
  } catch {
    ciphertext?.fill(0);
    for (const attempt of attempts.results) {
      await db.prepare(`
        UPDATE delivery_attempts
        SET submission_failure_category = 'attachment_preparation_failed', submission_failed_at = ?
        WHERE id = ? AND delivery_state = 'PENDING_SUBMISSION' AND provider_message_id IS NULL
      `).bind(now, attempt.id).run();
      result.failed.push(attempt.recipient_role);
    }
    return result;
  } finally {
    ciphertext?.fill(0);
  }

  try {
    if (await sha256Hex(pdfBytes) !== document.document_hash) {
      throw new Error("Prepared PDF failed delivery identity validation");
    }
    const attachmentContent = bytesToBase64(pdfBytes);
    for (const attempt of attempts.results) {
      const role = attempt.recipient_role;
      let providerSubmissionStarted = false;
      try {
      const claimed = await db.prepare(`
        UPDATE delivery_attempts SET submission_calls = submission_calls + 1, submission_call_at = ?
        WHERE id = ? AND delivery_state = 'PENDING_SUBMISSION' AND provider_message_id IS NULL
      `).bind(now, attempt.id).run();
      if (claimed.meta.changes === 0) continue;
      providerSubmissionStarted = true;
      const receipt = await dependencies.provider.submit({
        recipientRole: role,
        recipientEmail: role === "PRODUCTION"
          ? addresses.productionEmail
          : addresses.signerEmail,
        attachmentContent,
        attachmentByteLength: pdfBytes.byteLength,
        attachmentFilename: "sealproof-release.pdf",
        documentHash: attempt.document_hash,
        idempotencyKey: idempotencyKey(transactionId, role, attempt.attempt_number),
      });
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(receipt.providerMessageId)) {
        throw new Error("INVALID_PROVIDER_MESSAGE_ID");
      }
      const updated = await db.prepare(`
        UPDATE delivery_attempts
        SET provider_message_id = ?, delivery_state = 'ACCEPTED',
          submission_failure_category = NULL, submission_failed_at = NULL
        WHERE id = ? AND transaction_id = ? AND recipient_role = ?
          AND delivery_state = 'PENDING_SUBMISSION' AND provider_message_id IS NULL
      `).bind(receipt.providerMessageId, attempt.id, transactionId, role).run();
      if (updated.meta.changes === 1) {
        result.submitted.push(role);
      } else {
        const recovered = await db.prepare(`
          SELECT 1 AS matched FROM delivery_attempts
          WHERE id = ? AND provider_message_id = ? AND delivery_state = 'ACCEPTED'
        `).bind(attempt.id, receipt.providerMessageId).first();
        if (!recovered) throw new Error("SUBMISSION_STATE_CONFLICT");
        result.alreadySubmitted.push(role);
      }
      } catch (error) {
        if (budgetExhausted(error)) throw error;
        await db.prepare(`
        UPDATE delivery_attempts
        SET submission_failure_category = ?, submission_failed_at = ?
        WHERE id = ? AND transaction_id = ? AND recipient_role = ?
          AND delivery_state = 'PENDING_SUBMISSION' AND provider_message_id IS NULL
      `).bind(
        submissionFailureCategory(error, providerSubmissionStarted),
        now,
        attempt.id,
        transactionId,
        role,
      ).run();
        result.failed.push(role);
      }
    }
  } finally {
    pdfBytes.fill(0);
  }
  return result;
}

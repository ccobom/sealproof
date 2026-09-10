import type { KeyEncryptionKeys } from "../crypto/temporary-pii";
import { loadTemporaryEmailAddresses } from "../release/release-state";
import type { DeliveryProvider, DeliveryRecipientRole } from "./delivery-provider";
import { ResendDeliveryError } from "./resend-delivery-provider";
import {
  issueProviderAttachmentTicket,
  type ProviderAttachmentTicketKeys,
} from "./provider-attachment-ticket";
import {
  decryptProviderTicketFromStorage,
  encryptProviderTicketForStorage,
} from "./provider-ticket-storage";

interface PendingAttemptRow {
  id: number;
  recipient_role: DeliveryRecipientRole;
  attempt_number: number;
  document_hash: string;
  expires_at: number;
  provider_ticket_envelope: string | null;
}

export interface PendingDeliveryDependencies {
  provider: DeliveryProvider;
  keyEncryptionKeys: KeyEncryptionKeys;
  providerAttachmentKeyVersion: string;
  providerAttachmentKeys: ProviderAttachmentTicketKeys;
  publicOrigin: string;
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
  const origin = new URL(dependencies.publicOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Provider attachment origin must be an HTTPS origin");
  }
  const result: PendingDeliveryResult = { submitted: [], alreadySubmitted: [], failed: [] };
  const existing = await db.prepare(`
    SELECT recipient_role FROM delivery_attempts
    WHERE transaction_id = ? AND provider_message_id IS NOT NULL
  `).bind(transactionId).all<{ recipient_role: DeliveryRecipientRole }>();
  result.alreadySubmitted.push(...existing.results.map((row) => row.recipient_role));

  const attempts = await db.prepare(`
    SELECT da.id, da.recipient_role, da.attempt_number, da.provider_ticket_envelope,
      ar.document_hash, tr.expires_at
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

  for (const attempt of attempts.results) {
    const role = attempt.recipient_role;
    let providerSubmissionStarted = false;
    try {
      const activeKey = dependencies.providerAttachmentKeys[dependencies.providerAttachmentKeyVersion];
      if (!activeKey) throw new Error("Missing active provider attachment key");
      let envelope = attempt.provider_ticket_envelope;
      if (envelope === null) {
        const issuedTicket = await issueProviderAttachmentTicket({
          transactionId,
          attemptId: attempt.id,
          recipientRole: role,
          documentHash: attempt.document_hash,
          expiresAt: attempt.expires_at,
        }, dependencies.providerAttachmentKeyVersion, activeKey, now);
        const proposedEnvelope = await encryptProviderTicketForStorage(
          issuedTicket,
          dependencies.providerAttachmentKeyVersion,
          activeKey,
          transactionId,
          attempt.id,
        );
        await db.prepare(`
          UPDATE delivery_attempts SET provider_ticket_envelope = ?
          WHERE id = ? AND provider_ticket_envelope IS NULL
            AND delivery_state = 'PENDING_SUBMISSION'
        `).bind(proposedEnvelope, attempt.id).run();
        const stored = await db.prepare(`
          SELECT provider_ticket_envelope FROM delivery_attempts WHERE id = ?
        `).bind(attempt.id).first<{ provider_ticket_envelope: string | null }>();
        envelope = stored?.provider_ticket_envelope ?? null;
      }
      if (envelope === null) throw new Error("Provider ticket was not persisted");
      const ticket = await decryptProviderTicketFromStorage(
        envelope, dependencies.providerAttachmentKeys, transactionId, attempt.id,
      );
      const attachmentUrl = new URL(
        `/api/provider/attachments/${ticket}`,
        origin,
      ).toString();
      providerSubmissionStarted = true;
      const receipt = await dependencies.provider.submit({
        recipientRole: role,
        recipientEmail: role === "PRODUCTION"
          ? addresses.productionEmail
          : addresses.signerEmail,
        attachmentUrl,
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
  return result;
}

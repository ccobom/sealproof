import {
  decryptTemporaryEmailAddresses,
  encryptTemporaryEmailAddresses,
  type KeyEncryptionKeys,
  type TemporaryEmailAddresses,
} from "../crypto/temporary-pii";
import { calculateExpiry } from "../delivery/state";

export interface CreateReleaseStateInput {
  transactionId: string;
  documentHash: string;
  workflowVersion: string;
  finalizedAt: number;
  documentSize: number;
  r2ObjectKey: string;
  statusCapabilityHash: string;
  downloadCapabilityHash: string;
  emailAddresses: TemporaryEmailAddresses;
  keyVersion: string;
  keyEncryptionKey: Uint8Array;
}

export interface CreatedReleaseState {
  transactionId: string;
  expiresAt: number;
}

interface StoredEnvelopeRow {
  envelope_version: number;
  key_version: string;
  envelope_iv: string;
  email_ciphertext: string;
  wrapped_key_iv: string;
  wrapped_data_key: string;
}

function requireLength(value: string, label: string, minimum: number, maximum: number): void {
  if (value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain between ${minimum} and ${maximum} characters`);
  }
}

function requireHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
}

function validateInput(input: CreateReleaseStateInput): void {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.transactionId)) {
    throw new Error("Transaction ID must contain 16-128 safe identifier characters");
  }
  requireHash(input.documentHash, "Document hash");
  requireHash(input.statusCapabilityHash, "Status capability hash");
  requireHash(input.downloadCapabilityHash, "Download capability hash");
  requireLength(input.workflowVersion, "Workflow version", 1, 64);
  requireLength(input.r2ObjectKey, "R2 object key", 1, 1_024);
  if (!Number.isSafeInteger(input.documentSize) || input.documentSize < 1) {
    throw new Error("Document size must be a positive safe integer");
  }
}

export async function createReleaseState(
  db: D1Database,
  input: CreateReleaseStateInput,
): Promise<CreatedReleaseState> {
  validateInput(input);
  const expiresAt = calculateExpiry(input.finalizedAt);
  const encrypted = await encryptTemporaryEmailAddresses(
    input.emailAddresses,
    input.transactionId,
    input.keyVersion,
    input.keyEncryptionKey,
  );

  await db.batch([
    db.prepare(`
      INSERT INTO audit_releases (
        transaction_id, document_hash, hash_algorithm, workflow_version,
        finalized_at, release_state
      ) VALUES (?, ?, 'SHA-256', ?, ?, 'FINALIZING')
    `).bind(
      input.transactionId,
      input.documentHash,
      input.workflowVersion,
      input.finalizedAt,
    ),
    db.prepare(`
      INSERT INTO temporary_releases (
        transaction_id, envelope_version, key_version, envelope_iv,
        email_ciphertext, wrapped_key_iv, wrapped_data_key, document_size, r2_object_key,
        status_capability_hash, download_capability_hash, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.transactionId,
      encrypted.version,
      encrypted.keyVersion,
      encrypted.envelopeIv,
      encrypted.ciphertext,
      encrypted.wrappedKeyIv,
      encrypted.wrappedKey,
      input.documentSize,
      input.r2ObjectKey,
      input.statusCapabilityHash,
      input.downloadCapabilityHash,
      expiresAt,
    ),
    db.prepare(`
      INSERT INTO delivery_attempts (
        transaction_id, recipient_role, attempt_number, delivery_state, created_at
      ) VALUES (?, 'PRODUCTION', 1, 'PENDING_SUBMISSION', ?)
    `).bind(input.transactionId, input.finalizedAt),
    db.prepare(`
      INSERT INTO delivery_attempts (
        transaction_id, recipient_role, attempt_number, delivery_state, created_at
      ) VALUES (?, 'SIGNER', 1, 'PENDING_SUBMISSION', ?)
    `).bind(input.transactionId, input.finalizedAt),
  ]);

  return { transactionId: input.transactionId, expiresAt };
}

export async function markReleaseSealed(
  db: D1Database,
  transactionId: string,
  now: number,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE audit_releases SET release_state = 'SEALED_AWAITING_DELIVERY'
    WHERE transaction_id = ? AND release_state = 'FINALIZING'
      AND EXISTS (
        SELECT 1 FROM temporary_releases
        WHERE transaction_id = ? AND cleanup_started_at IS NULL AND expires_at > ?
      )
  `).bind(transactionId, transactionId, now).run();
  return result.meta.changes === 1;
}

export async function loadTemporaryEmailAddresses(
  db: D1Database,
  transactionId: string,
  keyEncryptionKeys: KeyEncryptionKeys,
  now: number,
): Promise<TemporaryEmailAddresses | null> {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative safe integer");
  }
  const row = await db.prepare(`
    SELECT envelope_version, key_version, envelope_iv, email_ciphertext,
      wrapped_key_iv, wrapped_data_key
    FROM temporary_releases
    WHERE transaction_id = ? AND cleanup_started_at IS NULL AND expires_at > ?
  `).bind(transactionId, now).first<StoredEnvelopeRow>();
  if (!row) return null;

  if (row.envelope_version !== 1) throw new Error("Unsupported encrypted-envelope version");
  return decryptTemporaryEmailAddresses({
    version: 1,
    keyVersion: row.key_version,
    envelopeIv: row.envelope_iv,
    ciphertext: row.email_ciphertext,
    wrappedKeyIv: row.wrapped_key_iv,
    wrappedKey: row.wrapped_data_key,
  }, transactionId, keyEncryptionKeys);
}

import { decryptTemporaryPdf, type EncryptedTemporaryPdfMetadata } from "../crypto/temporary-pdf";
import {
  openProviderAttachmentTicket,
  type ProviderAttachmentTicketKeys,
} from "../delivery/provider-attachment-ticket";
import { sha256Hex } from "../document/hash";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

interface AttachmentRow {
  transaction_id: string;
  recipient_role: "PRODUCTION" | "SIGNER";
  document_hash: string;
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

export interface ProviderAttachmentEnvironment {
  RELEASE_DB: D1Database;
  RELEASE_DOCUMENTS: R2Bucket;
  EXPECTED_HOSTNAME: string;
  KEY_ENCRYPTION_KEY_BASE64: string;
  ACTIVE_KEY_VERSION: string;
  ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION: string;
  PROVIDER_ATTACHMENT_KEYS_JSON: string;
}

function hiddenNotFound(): Response {
  return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE_HEADERS });
}

function serviceUnavailable(): Response {
  return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers: NO_STORE_HEADERS });
}

function decodeKey(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    return binary.length === 32
      ? Uint8Array.from(binary, (character) => character.charCodeAt(0))
      : undefined;
  } catch {
    return undefined;
  }
}

function loadProviderKeys(value: string): ProviderAttachmentTicketKeys | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed);
    if (entries.length < 1 || entries.length > 4) return undefined;
    const keys: Record<string, Uint8Array> = {};
    for (const [version, encoded] of entries) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(version) || typeof encoded !== "string") return undefined;
      const key = decodeKey(encoded);
      if (!key) return undefined;
      keys[version] = key;
    }
    return keys;
  } catch {
    return undefined;
  }
}

async function stillAuthorized(
  db: D1Database,
  transactionId: string,
  attemptId: number,
  recipientRole: string,
  now: number,
): Promise<boolean> {
  return await db.prepare(`
    SELECT 1 AS allowed FROM delivery_attempts da
    JOIN temporary_releases tr ON tr.transaction_id = da.transaction_id
    JOIN audit_releases ar ON ar.transaction_id = tr.transaction_id
    WHERE da.id = ? AND da.transaction_id = ? AND da.recipient_role = ?
      AND tr.cleanup_started_at IS NULL AND tr.expires_at > ?
      AND ar.release_state != 'FINALIZING'
  `).bind(attemptId, transactionId, recipientRole, now).first() !== null;
}

export async function handleProviderAttachmentRequest(
  request: Request,
  environment: ProviderAttachmentEnvironment,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { ...NO_STORE_HEADERS, allow: "GET" } });
  }
  if (!Number.isSafeInteger(now) || now < 0) return serviceUnavailable();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/provider\/attachments\/([A-Za-z0-9._-]{1,2048})$/);
  if (url.protocol !== "https:" || url.hostname !== environment.EXPECTED_HOSTNAME || !match) {
    return hiddenNotFound();
  }
  const providerKeys = loadProviderKeys(environment.PROVIDER_ATTACHMENT_KEYS_JSON);
  const pdfKey = decodeKey(environment.KEY_ENCRYPTION_KEY_BASE64);
  if (!providerKeys || !pdfKey || !providerKeys[environment.ACTIVE_PROVIDER_ATTACHMENT_KEY_VERSION]) {
    pdfKey?.fill(0);
    return serviceUnavailable();
  }

  try {
    const opened = await openProviderAttachmentTicket(match[1], providerKeys, now);
    if (!opened.valid) return hiddenNotFound();
    const { transactionId, attemptId, recipientRole, documentHash } = opened.payload;
    const row = await environment.RELEASE_DB.prepare(`
      SELECT tr.transaction_id, da.recipient_role, ar.document_hash, tr.document_size,
        tr.r2_object_key, tr.storage_format, tr.pdf_envelope_version, tr.pdf_key_version,
        tr.pdf_document_iv, tr.pdf_wrapped_key_iv, tr.pdf_wrapped_data_key,
        tr.stored_ciphertext_size, tr.stored_ciphertext_hash
      FROM delivery_attempts da
      JOIN temporary_releases tr ON tr.transaction_id = da.transaction_id
      JOIN audit_releases ar ON ar.transaction_id = tr.transaction_id
      WHERE da.id = ? AND da.transaction_id = ? AND da.recipient_role = ?
        AND tr.cleanup_started_at IS NULL AND tr.expires_at > ?
        AND ar.release_state != 'FINALIZING' AND ar.document_hash = ?
    `).bind(attemptId, transactionId, recipientRole, now, documentHash).first<AttachmentRow>();
    if (!row || row.storage_format !== "ENCRYPTED_V1" || row.pdf_envelope_version !== 1) {
      return row ? serviceUnavailable() : hiddenNotFound();
    }
    const object = await environment.RELEASE_DOCUMENTS.get(row.r2_object_key);
    if (!object) return serviceUnavailable();
    const ciphertext = new Uint8Array(await object.arrayBuffer());
    try {
      if (
        ciphertext.byteLength !== row.stored_ciphertext_size
        || await sha256Hex(ciphertext) !== row.stored_ciphertext_hash
      ) return serviceUnavailable();
      const metadata: EncryptedTemporaryPdfMetadata = {
        version: 1,
        keyVersion: row.pdf_key_version,
        documentIv: row.pdf_document_iv,
        wrappedKeyIv: row.pdf_wrapped_key_iv,
        wrappedKey: row.pdf_wrapped_data_key,
        plaintextBytes: row.document_size,
      };
      const pdfBytes = await decryptTemporaryPdf(
        ciphertext,
        metadata,
        transactionId,
        documentHash,
        { [environment.ACTIVE_KEY_VERSION]: pdfKey },
      );
      if (!await stillAuthorized(
        environment.RELEASE_DB, transactionId, attemptId, recipientRole, now,
      )) {
        pdfBytes.fill(0);
        return hiddenNotFound();
      }
      return new Response(pdfBytes.buffer as ArrayBuffer, {
        headers: {
          ...NO_STORE_HEADERS,
          "content-type": "application/pdf",
          "content-disposition": "attachment; filename=sealproof-release.pdf",
          "content-length": String(pdfBytes.byteLength),
          "x-sealproof-sha256": documentHash,
        },
      });
    } finally {
      ciphertext.fill(0);
    }
  } catch {
    return serviceUnavailable();
  } finally {
    pdfKey.fill(0);
    for (const key of Object.values(providerKeys)) key.fill(0);
  }
}

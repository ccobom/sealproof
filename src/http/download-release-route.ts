import { decryptTemporaryPdf, type EncryptedTemporaryPdfMetadata } from "../crypto/temporary-pdf";
import { sha256Hex } from "../document/hash";
import type { KeyEncryptionKeys } from "../crypto/temporary-pii";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

interface DownloadRow {
  transaction_id: string;
  document_hash: string;
  release_state: string;
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

export interface DownloadRouteEnvironment {
  RELEASE_DB: D1Database;
  RELEASE_DOCUMENTS: R2Bucket;
  keyEncryptionKeys: KeyEncryptionKeys;
}

function hiddenNotFound(): Response {
  return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE_HEADERS });
}

function serviceUnavailable(): Response {
  return Response.json(
    { error: "SERVICE_UNAVAILABLE" },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

function bearerCapability(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const capability = authorization.slice("Bearer ".length);
  return /^[A-Za-z0-9_-]{43}$/.test(capability) ? capability : undefined;
}

async function accessStillActive(
  db: D1Database,
  transactionId: string,
  capabilityHash: string,
  now: number,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 AS allowed FROM temporary_releases tr
    JOIN audit_releases ar ON ar.transaction_id = tr.transaction_id
    WHERE tr.transaction_id = ? AND tr.download_capability_hash = ?
      AND tr.cleanup_started_at IS NULL AND tr.expires_at > ?
      AND ar.release_state != 'FINALIZING'
  `).bind(transactionId, capabilityHash, now).first();
  return row !== null;
}

export async function handleDownloadReleaseRequest(
  request: Request,
  environment: DownloadRouteEnvironment,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { ...NO_STORE_HEADERS, allow: "GET" },
    });
  }
  if (!Number.isSafeInteger(now) || now < 0) return serviceUnavailable();

  const match = new URL(request.url).pathname.match(/^\/api\/releases\/([A-Za-z0-9_-]{16,128})\/document$/);
  const capability = bearerCapability(request);
  if (!match || !capability) return hiddenNotFound();
  const transactionId = match[1];
  const capabilityHash = await sha256Hex(new TextEncoder().encode(capability));

  const row = await environment.RELEASE_DB.prepare(`
    SELECT tr.transaction_id, ar.document_hash, ar.release_state, tr.document_size,
      tr.r2_object_key, tr.storage_format, tr.pdf_envelope_version, tr.pdf_key_version,
      tr.pdf_document_iv, tr.pdf_wrapped_key_iv, tr.pdf_wrapped_data_key,
      tr.stored_ciphertext_size, tr.stored_ciphertext_hash
    FROM temporary_releases tr
    JOIN audit_releases ar ON ar.transaction_id = tr.transaction_id
    WHERE tr.transaction_id = ? AND tr.download_capability_hash = ?
      AND tr.cleanup_started_at IS NULL AND tr.expires_at > ?
      AND ar.release_state != 'FINALIZING'
  `).bind(transactionId, capabilityHash, now).first<DownloadRow>();
  if (!row) return hiddenNotFound();
  if (row.storage_format !== "ENCRYPTED_V1" || row.pdf_envelope_version !== 1) {
    return serviceUnavailable();
  }

  const object = await environment.RELEASE_DOCUMENTS.get(row.r2_object_key);
  if (!object) return serviceUnavailable();
  const ciphertext = new Uint8Array(await object.arrayBuffer());
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

  try {
    const pdfBytes = await decryptTemporaryPdf(
      ciphertext,
      metadata,
      transactionId,
      row.document_hash,
      environment.keyEncryptionKeys,
    );
    if (!await accessStillActive(environment.RELEASE_DB, transactionId, capabilityHash, now)) {
      pdfBytes.fill(0);
      return hiddenNotFound();
    }
    return new Response(pdfBytes.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=sealproof-release.pdf",
        "content-length": String(pdfBytes.byteLength),
        "x-sealproof-sha256": row.document_hash,
      },
    });
  } catch {
    return serviceUnavailable();
  } finally {
    ciphertext.fill(0);
  }
}

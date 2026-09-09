import { sha256Hex } from "../document/hash";
import { validatePdfUpload } from "../document/pdf-contract";

const ENVELOPE_VERSION = 1 as const;
const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;

export interface EncryptedTemporaryPdfMetadata {
  version: typeof ENVELOPE_VERSION;
  keyVersion: string;
  documentIv: string;
  wrappedKeyIv: string;
  wrappedKey: string;
  plaintextBytes: number;
}

export interface EncryptedTemporaryPdf {
  ciphertext: Uint8Array;
  metadata: EncryptedTemporaryPdfMetadata;
}

function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`${label} must contain 1-128 safe identifier characters`);
  }
}

function requireDocumentHash(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Document hash must be lowercase SHA-256 hex");
}

function requireKey(key: Uint8Array): void {
  if (key.length !== AES_KEY_BYTES) throw new Error("Key-encryption key must be 32 bytes");
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string, label: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical Base64`);
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function documentAdditionalData(
  transactionId: string,
  documentHash: string,
  plaintextBytes: number,
): Uint8Array {
  return new TextEncoder().encode(
    `sealproof:temporary-pdf:v${ENVELOPE_VERSION}:${transactionId}:${documentHash}:${plaintextBytes}`,
  );
}

function wrappingAdditionalData(transactionId: string, keyVersion: string): Uint8Array {
  return new TextEncoder().encode(
    `sealproof:wrapped-pdf-key:v${ENVELOPE_VERSION}:${keyVersion}:${transactionId}`,
  );
}

async function importKey(rawKey: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  requireKey(rawKey);
  return crypto.subtle.importKey("raw", new Uint8Array(rawKey), "AES-GCM", false, [usage]);
}

export async function encryptTemporaryPdf(
  pdfBytes: Uint8Array,
  transactionId: string,
  documentHash: string,
  keyVersion: string,
  keyEncryptionKey: Uint8Array,
): Promise<EncryptedTemporaryPdf> {
  requireIdentifier(transactionId, "Transaction ID");
  requireIdentifier(keyVersion, "Key version");
  requireDocumentHash(documentHash);
  requireKey(keyEncryptionKey);
  const contract = validatePdfUpload(pdfBytes);
  if (!contract.valid) throw new Error(`PDF failed encryption boundary: ${contract.reason}`);
  if (await sha256Hex(pdfBytes) !== documentHash) throw new Error("PDF does not match its document hash");

  const plaintext = new Uint8Array(pdfBytes);
  const dataKeyBytes = crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES));
  const documentIv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const wrappedKeyIv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  try {
    const dataKey = await importKey(dataKeyBytes, "encrypt");
    const wrappingKey = await importKey(keyEncryptionKey, "encrypt");
    const ciphertext = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: documentIv,
      additionalData: documentAdditionalData(transactionId, documentHash, plaintext.byteLength),
    }, dataKey, plaintext);
    const wrappedKey = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: wrappedKeyIv,
      additionalData: wrappingAdditionalData(transactionId, keyVersion),
    }, wrappingKey, dataKeyBytes);

    return {
      ciphertext: new Uint8Array(ciphertext),
      metadata: {
        version: ENVELOPE_VERSION,
        keyVersion,
        documentIv: encodeBase64(documentIv),
        wrappedKeyIv: encodeBase64(wrappedKeyIv),
        wrappedKey: encodeBase64(new Uint8Array(wrappedKey)),
        plaintextBytes: plaintext.byteLength,
      },
    };
  } finally {
    plaintext.fill(0);
    dataKeyBytes.fill(0);
  }
}

export async function decryptTemporaryPdf(
  ciphertext: Uint8Array,
  metadata: EncryptedTemporaryPdfMetadata,
  transactionId: string,
  documentHash: string,
  keyEncryptionKeys: Readonly<Record<string, Uint8Array>>,
): Promise<Uint8Array> {
  requireIdentifier(transactionId, "Transaction ID");
  requireDocumentHash(documentHash);
  if (metadata.version !== ENVELOPE_VERSION) throw new Error("Unsupported PDF envelope version");
  requireIdentifier(metadata.keyVersion, "Key version");
  if (!Number.isSafeInteger(metadata.plaintextBytes) || metadata.plaintextBytes < 1) {
    throw new Error("Invalid PDF plaintext size");
  }
  const keyEncryptionKey = keyEncryptionKeys[metadata.keyVersion];
  if (!keyEncryptionKey) throw new Error("Required key-encryption-key version is unavailable");

  const documentIv = decodeBase64(metadata.documentIv, "Document IV");
  const wrappedKeyIv = decodeBase64(metadata.wrappedKeyIv, "Wrapped-key IV");
  if (documentIv.length !== GCM_IV_BYTES || wrappedKeyIv.length !== GCM_IV_BYTES) {
    throw new Error("AES-GCM IV must be 12 bytes");
  }
  const wrappedKey = decodeBase64(metadata.wrappedKey, "Wrapped key");
  const wrappingKey = await importKey(keyEncryptionKey, "decrypt");
  const dataKeyBytes = new Uint8Array(await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: wrappedKeyIv,
    additionalData: wrappingAdditionalData(transactionId, metadata.keyVersion),
  }, wrappingKey, wrappedKey));

  try {
    const dataKey = await importKey(dataKeyBytes, "decrypt");
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: documentIv,
      additionalData: documentAdditionalData(transactionId, documentHash, metadata.plaintextBytes),
    }, dataKey, new Uint8Array(ciphertext)));
    if (plaintext.byteLength !== metadata.plaintextBytes) {
      plaintext.fill(0);
      throw new Error("Decrypted PDF size does not match authenticated metadata");
    }
    const contract = validatePdfUpload(plaintext);
    if (!contract.valid || await sha256Hex(plaintext) !== documentHash) {
      plaintext.fill(0);
      throw new Error("Decrypted PDF failed integrity validation");
    }
    return plaintext;
  } finally {
    dataKeyBytes.fill(0);
  }
}

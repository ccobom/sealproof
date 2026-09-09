import type { ProviderAttachmentTicketKeys } from "./provider-attachment-ticket";

const VERSION = 1;
const IV_BYTES = 12;

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return encode(bytes) === value ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function aad(keyVersion: string, transactionId: string, attemptId: number): Uint8Array {
  return new TextEncoder().encode(
    `sealproof:provider-ticket-storage:v${VERSION}:${keyVersion}:${transactionId}:${attemptId}`,
  );
}

async function key(bytes: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  if (bytes.byteLength !== 32) throw new Error("Provider ticket storage key must be 32 bytes");
  return crypto.subtle.importKey("raw", new Uint8Array(bytes), "AES-GCM", false, [usage]);
}

export async function encryptProviderTicketForStorage(
  ticket: string,
  keyVersion: string,
  keyBytes: Uint8Array,
  transactionId: string,
  attemptId: number,
): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(keyVersion)) throw new Error("Invalid key version");
  const plaintext = new TextEncoder().encode(ticket);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(keyVersion, transactionId, attemptId) },
      await key(keyBytes, "encrypt"),
      plaintext,
    ));
    return `v${VERSION}.${keyVersion}.${encode(iv)}.${encode(ciphertext)}`;
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptProviderTicketFromStorage(
  envelope: string,
  keys: ProviderAttachmentTicketKeys,
  transactionId: string,
  attemptId: number,
): Promise<string> {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== `v${VERSION}`) throw new Error("Invalid ticket envelope");
  const [, keyVersion, encodedIv, encodedCiphertext] = parts;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(keyVersion)) throw new Error("Invalid ticket envelope");
  const iv = decode(encodedIv);
  const ciphertext = decode(encodedCiphertext);
  const keyBytes = keys[keyVersion];
  if (!iv || iv.byteLength !== IV_BYTES || !ciphertext || !keyBytes) {
    throw new Error("Invalid ticket envelope");
  }
  const plaintext = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad(keyVersion, transactionId, attemptId) },
    await key(keyBytes, "decrypt"),
    ciphertext,
  ));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plaintext);
  } finally {
    plaintext.fill(0);
  }
}

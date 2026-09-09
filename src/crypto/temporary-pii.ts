const ENVELOPE_VERSION = 1 as const;
const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const MAXIMUM_EMAIL_LENGTH = 320;

export interface TemporaryEmailAddresses {
  productionEmail: string;
  signerEmail: string;
}

export interface EncryptedTemporaryEmailAddresses {
  version: typeof ENVELOPE_VERSION;
  keyVersion: string;
  envelopeIv: string;
  ciphertext: string;
  wrappedKeyIv: string;
  wrappedKey: string;
}

export type KeyEncryptionKeys = Readonly<Record<string, Uint8Array>>;

function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`${label} must contain 1-128 safe identifier characters`);
  }
}

function validateAddresses(value: TemporaryEmailAddresses): void {
  for (const [label, address] of Object.entries(value)) {
    if (typeof address !== "string" || address.length < 3 || address.length > MAXIMUM_EMAIL_LENGTH) {
      throw new Error(`${label} has an invalid length`);
    }
  }
}

function validateKeyBytes(key: Uint8Array): void {
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
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function envelopeAdditionalData(transactionId: string): Uint8Array {
  return new TextEncoder().encode(`sealproof:temporary-email-addresses:v${ENVELOPE_VERSION}:${transactionId}`);
}

function wrappingAdditionalData(transactionId: string, keyVersion: string): Uint8Array {
  return new TextEncoder().encode(`sealproof:wrapped-data-key:v${ENVELOPE_VERSION}:${keyVersion}:${transactionId}`);
}

async function importAesGcmKey(
  rawKey: Uint8Array,
  usages: Array<"encrypt" | "decrypt">,
): Promise<CryptoKey> {
  validateKeyBytes(rawKey);
  return crypto.subtle.importKey("raw", new Uint8Array(rawKey), "AES-GCM", false, usages);
}

export async function encryptTemporaryEmailAddresses(
  addresses: TemporaryEmailAddresses,
  transactionId: string,
  keyVersion: string,
  keyEncryptionKey: Uint8Array,
): Promise<EncryptedTemporaryEmailAddresses> {
  requireIdentifier(transactionId, "Transaction ID");
  requireIdentifier(keyVersion, "Key version");
  validateAddresses(addresses);
  validateKeyBytes(keyEncryptionKey);

  const dataKeyBytes = crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES));
  const envelopeIv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const wrappedKeyIv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(addresses));

  try {
    const dataKey = await importAesGcmKey(dataKeyBytes, ["encrypt"]);
    const wrappingKey = await importAesGcmKey(keyEncryptionKey, ["encrypt"]);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: envelopeIv, additionalData: envelopeAdditionalData(transactionId) },
      dataKey,
      plaintext,
    );
    const wrappedKey = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: wrappedKeyIv, additionalData: wrappingAdditionalData(transactionId, keyVersion) },
      wrappingKey,
      dataKeyBytes,
    );

    return {
      version: ENVELOPE_VERSION,
      keyVersion,
      envelopeIv: encodeBase64(envelopeIv),
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      wrappedKeyIv: encodeBase64(wrappedKeyIv),
      wrappedKey: encodeBase64(new Uint8Array(wrappedKey)),
    };
  } finally {
    dataKeyBytes.fill(0);
    plaintext.fill(0);
  }
}

export async function decryptTemporaryEmailAddresses(
  encrypted: EncryptedTemporaryEmailAddresses,
  transactionId: string,
  keyEncryptionKeys: KeyEncryptionKeys,
): Promise<TemporaryEmailAddresses> {
  requireIdentifier(transactionId, "Transaction ID");
  if (encrypted.version !== ENVELOPE_VERSION) throw new Error("Unsupported encrypted-envelope version");
  requireIdentifier(encrypted.keyVersion, "Key version");

  const keyEncryptionKey = keyEncryptionKeys[encrypted.keyVersion];
  if (!keyEncryptionKey) throw new Error("Required key-encryption-key version is unavailable");

  const envelopeIv = decodeBase64(encrypted.envelopeIv, "Envelope IV");
  const wrappedKeyIv = decodeBase64(encrypted.wrappedKeyIv, "Wrapped-key IV");
  if (envelopeIv.length !== GCM_IV_BYTES || wrappedKeyIv.length !== GCM_IV_BYTES) {
    throw new Error("AES-GCM IV must be 12 bytes");
  }

  const ciphertext = decodeBase64(encrypted.ciphertext, "Ciphertext");
  const wrappedKey = decodeBase64(encrypted.wrappedKey, "Wrapped key");
  const wrappingKey = await importAesGcmKey(keyEncryptionKey, ["decrypt"]);
  const dataKeyBytes = new Uint8Array(await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: wrappedKeyIv,
      additionalData: wrappingAdditionalData(transactionId, encrypted.keyVersion),
    },
    wrappingKey,
    wrappedKey,
  ));

  try {
    const dataKey = await importAesGcmKey(dataKeyBytes, ["decrypt"]);
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: envelopeIv, additionalData: envelopeAdditionalData(transactionId) },
      dataKey,
      ciphertext,
    ));

    try {
      const parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plaintext),
      ) as unknown;
      if (
        typeof parsed !== "object" || parsed === null ||
        Object.keys(parsed).sort().join(",") !== "productionEmail,signerEmail"
      ) {
        throw new Error("Decrypted email envelope has an invalid shape");
      }
      const addresses = parsed as TemporaryEmailAddresses;
      validateAddresses(addresses);
      return addresses;
    } finally {
      plaintext.fill(0);
    }
  } finally {
    dataKeyBytes.fill(0);
  }
}

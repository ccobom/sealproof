import { z } from "zod";

const VERSION = 1 as const;
const IV_BYTES = 12;
const KEY_BYTES = 32;
export const MAXIMUM_PROVIDER_ATTACHMENT_TICKET_LENGTH = 2_048;

const payloadSchema = z.strictObject({
  transactionId: z.uuid(),
  attemptId: z.number().int().positive().safe(),
  recipientRole: z.enum(["PRODUCTION", "SIGNER"]),
  documentHash: z.string().regex(/^[0-9a-f]{64}$/),
  issuedAt: z.number().int().nonnegative().safe(),
  expiresAt: z.number().int().positive().safe(),
});

export type ProviderAttachmentTicketPayload = z.infer<typeof payloadSchema>;
export type ProviderAttachmentTicketKeys = Readonly<Record<string, Uint8Array>>;

function validKeyVersion(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

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

function additionalData(keyVersion: string): Uint8Array {
  return new TextEncoder().encode(`sealproof:provider-attachment:v${VERSION}:${keyVersion}`);
}

async function importKey(key: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  if (key.byteLength !== KEY_BYTES) throw new Error("Provider attachment key must be 32 bytes");
  return crypto.subtle.importKey("raw", new Uint8Array(key), "AES-GCM", false, [usage]);
}

export async function issueProviderAttachmentTicket(
  input: Omit<ProviderAttachmentTicketPayload, "issuedAt">,
  keyVersion: string,
  key: Uint8Array,
  now: number,
): Promise<string> {
  if (!validKeyVersion(keyVersion) || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("Invalid provider attachment ticket configuration");
  }
  const payload = payloadSchema.parse({ ...input, issuedAt: now });
  if (payload.expiresAt <= now || payload.expiresAt - now > 7_200_000) {
    throw new Error("Provider attachment ticket must expire within the release window");
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  try {
    const cryptoKey = await importKey(key, "encrypt");
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(keyVersion) },
      cryptoKey,
      plaintext,
    ));
    const ticket = `v${VERSION}.${keyVersion}.${encode(iv)}.${encode(ciphertext)}`;
    if (ticket.length > MAXIMUM_PROVIDER_ATTACHMENT_TICKET_LENGTH) {
      throw new Error("Provider attachment ticket exceeds transport limit");
    }
    return ticket;
  } finally {
    plaintext.fill(0);
  }
}

export async function openProviderAttachmentTicket(
  ticket: string,
  keys: ProviderAttachmentTicketKeys,
  now: number,
): Promise<{ valid: true; payload: ProviderAttachmentTicketPayload } | { valid: false }> {
  if (
    typeof ticket !== "string" || ticket.length < 1
    || ticket.length > MAXIMUM_PROVIDER_ATTACHMENT_TICKET_LENGTH
    || !Number.isSafeInteger(now) || now < 0
  ) return { valid: false };
  const parts = ticket.split(".");
  if (parts.length !== 4 || parts[0] !== `v${VERSION}` || !validKeyVersion(parts[1])) {
    return { valid: false };
  }
  const [, keyVersion, encodedIv, encodedCiphertext] = parts;
  const iv = decode(encodedIv);
  const ciphertext = decode(encodedCiphertext);
  const key = keys[keyVersion];
  if (!iv || iv.byteLength !== IV_BYTES || !ciphertext || !key) return { valid: false };

  let plaintext: Uint8Array;
  try {
    const cryptoKey = await importKey(key, "decrypt");
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(keyVersion) },
      cryptoKey,
      ciphertext,
    ));
  } catch {
    return { valid: false };
  }
  try {
    let unknownPayload: unknown;
    try {
      unknownPayload = JSON.parse(new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: false,
      }).decode(plaintext));
    } catch {
      return { valid: false };
    }
    const parsed = payloadSchema.safeParse(unknownPayload);
    if (!parsed.success || parsed.data.expiresAt <= parsed.data.issuedAt || now >= parsed.data.expiresAt) {
      return { valid: false };
    }
    return { valid: true, payload: parsed.data };
  } finally {
    plaintext.fill(0);
  }
}

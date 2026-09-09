import { z } from "zod";

const TICKET_VERSION = 1 as const;
const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
export const FINALIZATION_TICKET_LIFETIME_MS = 5 * 60 * 1_000;
export const MAXIMUM_FINALIZATION_TICKET_LENGTH = 2_048;

const emailAddress = z.string().trim().max(254).pipe(z.email());
const payloadSchema = z.strictObject({
  admissionId: z.uuid(),
  productionEmail: emailAddress,
  signerEmail: emailAddress,
  documentHash: z.string().regex(/^[0-9a-f]{64}$/),
  workflowVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  issuedAt: z.number().int().nonnegative().safe(),
  expiresAt: z.number().int().positive().safe(),
});

export type FinalizationTicketPayload = z.infer<typeof payloadSchema>;
export type FinalizationTicketKeys = Readonly<Record<string, Uint8Array>>;

export interface FinalizationTicketInput {
  productionEmail: string;
  signerEmail: string;
  documentHash: string;
}

export type OpenFinalizationTicketResult =
  | { valid: true; payload: FinalizationTicketPayload }
  | { valid: false; reason: "INVALID" | "EXPIRED" | "KEY_UNAVAILABLE" };

function validKeyVersion(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const padding = "=".repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return encodeBase64Url(bytes) === value ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function additionalData(keyVersion: string): Uint8Array {
  return new TextEncoder().encode(`sealproof:finalization-ticket:v${TICKET_VERSION}:${keyVersion}`);
}

async function importKey(bytes: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  if (bytes.byteLength !== AES_KEY_BYTES) throw new Error("Finalization-ticket key must be 32 bytes");
  return crypto.subtle.importKey("raw", new Uint8Array(bytes), "AES-GCM", false, [usage]);
}

export async function issueFinalizationTicket(
  input: FinalizationTicketInput,
  workflowVersion: string,
  keyVersion: string,
  key: Uint8Array,
  now: number,
): Promise<{ ticket: string; expiresAt: number }> {
  if (!validKeyVersion(keyVersion)) throw new Error("Invalid finalization-ticket key version");
  const payload = payloadSchema.parse({
    ...input,
    admissionId: crypto.randomUUID(),
    workflowVersion,
    issuedAt: now,
    expiresAt: now + FINALIZATION_TICKET_LIFETIME_MS,
  });
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  try {
    const encryptionKey = await importKey(key, "encrypt");
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(keyVersion) },
      encryptionKey,
      plaintext,
    );
    const ticket = `v${TICKET_VERSION}.${keyVersion}.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
    if (ticket.length > MAXIMUM_FINALIZATION_TICKET_LENGTH) {
      throw new Error("Finalization ticket exceeds its transport limit");
    }
    return { ticket, expiresAt: payload.expiresAt };
  } finally {
    plaintext.fill(0);
  }
}

export async function openFinalizationTicket(
  ticket: string,
  keys: FinalizationTicketKeys,
  now: number,
): Promise<OpenFinalizationTicketResult> {
  if (
    typeof ticket !== "string"
    || ticket.length < 1
    || ticket.length > MAXIMUM_FINALIZATION_TICKET_LENGTH
    || !Number.isSafeInteger(now)
    || now < 0
  ) return { valid: false, reason: "INVALID" };

  const parts = ticket.split(".");
  if (parts.length !== 4 || parts[0] !== `v${TICKET_VERSION}` || !validKeyVersion(parts[1])) {
    return { valid: false, reason: "INVALID" };
  }
  const [, keyVersion, encodedIv, encodedCiphertext] = parts;
  const iv = decodeBase64Url(encodedIv);
  const ciphertext = decodeBase64Url(encodedCiphertext);
  if (!iv || iv.byteLength !== GCM_IV_BYTES || !ciphertext) {
    return { valid: false, reason: "INVALID" };
  }
  const key = keys[keyVersion];
  if (!key) return { valid: false, reason: "KEY_UNAVAILABLE" };

  let plaintext: Uint8Array;
  try {
    const decryptionKey = await importKey(key, "decrypt");
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(keyVersion) },
      decryptionKey,
      ciphertext,
    ));
  } catch {
    return { valid: false, reason: "INVALID" };
  }

  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plaintext));
    } catch {
      return { valid: false, reason: "INVALID" };
    }
    const result = payloadSchema.safeParse(parsed);
    if (!result.success) return { valid: false, reason: "INVALID" };
    if (result.data.expiresAt !== result.data.issuedAt + FINALIZATION_TICKET_LIFETIME_MS) {
      return { valid: false, reason: "INVALID" };
    }
    if (now >= result.data.expiresAt) return { valid: false, reason: "EXPIRED" };
    return { valid: true, payload: result.data };
  } finally {
    plaintext.fill(0);
  }
}

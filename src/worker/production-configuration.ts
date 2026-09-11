import type { ProductionEnvironment } from "./production-app";

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const WORKFLOW_VERSION = /^[A-Za-z0-9._-]{1,64}$/;
const HOSTNAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function decodeKey(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string"
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return undefined;
  }
  try {
    const binary = atob(value);
    return binary.length === 32
      ? Uint8Array.from(binary, (character) => character.charCodeAt(0))
      : undefined;
  } catch {
    return undefined;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function validSender(value: unknown): boolean {
  if (typeof value !== "string" || value.length < 3 || value.length > 320
    || /[\r\n]/.test(value)) return false;
  const bracketed = value.match(/^[^<>]{1,100}<([^<>]+)>$/);
  const address = bracketed?.[1].trim() ?? value;
  return /^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,63}$/.test(address);
}

function bindingMethods(value: unknown, methods: string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  return methods.every((method) => typeof (value as Record<string, unknown>)[method] === "function");
}

export function validCleanupBindings(environment: Partial<ProductionEnvironment>): boolean {
  return bindingMethods(environment.RELEASE_DB, ["prepare", "batch"])
    && bindingMethods(environment.RELEASE_DOCUMENTS, ["get", "put", "delete", "head"]);
}

export function validProductionConfiguration(
  environment: Partial<ProductionEnvironment>,
): boolean {
  if (!validCleanupBindings(environment)
    || typeof environment.EXPECTED_HOSTNAME !== "string"
    || !HOSTNAME.test(environment.EXPECTED_HOSTNAME)
    || environment.EXPECTED_HOSTNAME.endsWith(".example")
    || environment.EXPECTED_HOSTNAME.endsWith(".invalid")
    || typeof environment.ACTIVE_WORKFLOW_VERSION !== "string"
    || !WORKFLOW_VERSION.test(environment.ACTIVE_WORKFLOW_VERSION)
    || typeof environment.ACTIVE_KEY_VERSION !== "string"
    || !IDENTIFIER.test(environment.ACTIVE_KEY_VERSION)
    || typeof environment.ACTIVE_TICKET_KEY_VERSION !== "string"
    || !IDENTIFIER.test(environment.ACTIVE_TICKET_KEY_VERSION)
    || typeof environment.TURNSTILE_SECRET_KEY !== "string"
    || environment.TURNSTILE_SECRET_KEY.length < 16
    || environment.TURNSTILE_SECRET_KEY.length > 512
    || typeof environment.TURNSTILE_SITE_KEY !== "string"
    || !/^0x[A-Za-z0-9_-]{20,128}$/.test(environment.TURNSTILE_SITE_KEY)
    || typeof environment.RESEND_API_KEY !== "string"
    || !/^re_[A-Za-z0-9_-]{8,256}$/.test(environment.RESEND_API_KEY)
    || typeof environment.RESEND_WEBHOOK_SECRET !== "string"
    || !/^whsec_[A-Za-z0-9+/=_-]{16,512}$/.test(environment.RESEND_WEBHOOK_SECRET)
    || !validSender(environment.RESEND_FROM)) return false;

  const pdfKey = decodeKey(environment.KEY_ENCRYPTION_KEY_BASE64);
  const ticketKey = decodeKey(environment.TICKET_ENCRYPTION_KEY_BASE64);
  try {
    return Boolean(pdfKey && ticketKey && !sameBytes(pdfKey, ticketKey));
  } catch {
    return false;
  } finally {
    pdfKey?.fill(0);
    ticketKey?.fill(0);
  }
}

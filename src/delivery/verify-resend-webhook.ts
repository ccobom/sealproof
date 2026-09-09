import { Webhook } from "svix";
import { sha256Hex } from "../document/hash";
import type { DeliveryEvent } from "./state";
import type { VerifiedDeliveryEvent } from "./apply-verified-event";

const SUPPORTED_EVENTS = new Set<DeliveryEvent>([
  "email.sent",
  "email.delivery_delayed",
  "email.delivered",
  "email.failed",
  "email.bounced",
]);

export class ResendWebhookError extends Error {
  constructor(
    public readonly code:
      | "MISSING_HEADERS"
      | "INVALID_SIGNATURE"
      | "MALFORMED_PAYLOAD"
      | "UNSUPPORTED_EVENT",
  ) {
    super(code);
    this.name = "ResendWebhookError";
  }
}

function requiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (!value) throw new ResendWebhookError("MISSING_HEADERS");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePayload(rawBody: string): {
  eventType: DeliveryEvent;
  providerMessageId: string;
  providerEventAt: number;
} {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ResendWebhookError("MALFORMED_PAYLOAD");
  }

  if (!isRecord(payload) || typeof payload.type !== "string") {
    throw new ResendWebhookError("MALFORMED_PAYLOAD");
  }
  if (!SUPPORTED_EVENTS.has(payload.type as DeliveryEvent)) {
    throw new ResendWebhookError("UNSUPPORTED_EVENT");
  }
  if (!isRecord(payload.data) || typeof payload.data.email_id !== "string"
    || payload.data.email_id.length < 1 || payload.data.email_id.length > 256
    || typeof payload.created_at !== "string") {
    throw new ResendWebhookError("MALFORMED_PAYLOAD");
  }

  const providerEventAt = Date.parse(payload.created_at);
  if (!Number.isSafeInteger(providerEventAt) || providerEventAt < 0) {
    throw new ResendWebhookError("MALFORMED_PAYLOAD");
  }

  return {
    eventType: payload.type as DeliveryEvent,
    providerMessageId: payload.data.email_id,
    providerEventAt,
  };
}

export async function verifyResendWebhook(
  rawBody: string,
  headers: Headers,
  webhookSecret: string,
  receivedAt: number,
): Promise<VerifiedDeliveryEvent> {
  if (!webhookSecret) throw new Error("Resend webhook secret is not configured");
  if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) {
    throw new Error("receivedAt must be a non-negative safe integer");
  }

  const svixId = requiredHeader(headers, "svix-id");
  const timestamp = requiredHeader(headers, "svix-timestamp");
  const signature = requiredHeader(headers, "svix-signature");

  try {
    new Webhook(webhookSecret).verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    });
  } catch {
    throw new ResendWebhookError("INVALID_SIGNATURE");
  }

  const parsed = parsePayload(rawBody);
  const payloadHash = await sha256Hex(new TextEncoder().encode(rawBody));

  return {
    svixId,
    payloadHash,
    providerMessageId: parsed.providerMessageId,
    eventType: parsed.eventType,
    providerEventAt: parsed.providerEventAt,
    receivedAt,
  };
}

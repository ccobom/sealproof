import {
  applyVerifiedDeliveryEvent,
  type ApplyVerifiedEventResult,
} from "./apply-verified-event";
import { verifyResendWebhook } from "./verify-resend-webhook";

export const MAXIMUM_RESEND_WEBHOOK_BYTES = 65_536;

async function readBoundedUtf8Body(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > MAXIMUM_RESEND_WEBHOOK_BYTES) {
    throw new ResendWebhookBodyError("PAYLOAD_TOO_LARGE");
  }
  if (!request.body) throw new ResendWebhookBodyError("MALFORMED_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAXIMUM_RESEND_WEBHOOK_BYTES) {
      await reader.cancel();
      throw new ResendWebhookBodyError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ResendWebhookBodyError("MALFORMED_BODY");
  }
}

export class ResendWebhookBodyError extends Error {
  constructor(readonly code: "PAYLOAD_TOO_LARGE" | "MALFORMED_BODY") {
    super(code);
    this.name = "ResendWebhookBodyError";
  }
}

export async function processResendWebhookRequest(
  db: D1Database,
  request: Request,
  webhookSecret: string,
  receivedAt = Date.now(),
): Promise<ApplyVerifiedEventResult> {
  const rawBody = await readBoundedUtf8Body(request);
  const verifiedEvent = await verifyResendWebhook(
    rawBody,
    request.headers,
    webhookSecret,
    receivedAt,
  );
  return applyVerifiedDeliveryEvent(db, verifiedEvent);
}

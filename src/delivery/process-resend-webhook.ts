import {
  applyVerifiedDeliveryEvent,
  type ApplyVerifiedEventResult,
} from "./apply-verified-event";
import { verifyResendWebhook } from "./verify-resend-webhook";

export async function processResendWebhookRequest(
  db: D1Database,
  request: Request,
  webhookSecret: string,
  receivedAt = Date.now(),
): Promise<ApplyVerifiedEventResult> {
  const rawBody = await request.text();
  const verifiedEvent = await verifyResendWebhook(
    rawBody,
    request.headers,
    webhookSecret,
    receivedAt,
  );
  return applyVerifiedDeliveryEvent(db, verifiedEvent);
}

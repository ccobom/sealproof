import { Webhook } from "svix";
import { z } from "zod";
import { processResendWebhookRequest } from "../delivery/process-resend-webhook";
import { sha256Hex } from "../document/hash";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;
const MAXIMUM_BODY_BYTES = 256;

const inputSchema = z.strictObject({
  recipientRole: z.enum(["PRODUCTION", "SIGNER"]),
  eventType: z.enum(["email.delivered", "email.bounced"]),
});

interface AttemptRow {
  provider_message_id: string;
}

export interface LocalFakeWebhookEnvironment {
  RELEASE_DB: D1Database;
  EXPECTED_HOSTNAME: string;
  LOCAL_RESEND_WEBHOOK_SECRET: string;
}

function error(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: NO_STORE_HEADERS });
}

function capability(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const value = authorization.slice("Bearer ".length);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

export async function handleLocalFakeWebhookRequest(
  request: Request,
  environment: LocalFakeWebhookEnvironment,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...NO_STORE_HEADERS, allow: "POST" } });
  }
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/api\/local\/releases\/([A-Za-z0-9_-]{16,128})\/fake-webhook$/,
  );
  if (
    url.protocol !== "https:" || url.hostname !== environment.EXPECTED_HOSTNAME
    || request.headers.get("origin") !== url.origin || !match
    || !Number.isSafeInteger(now) || now < 0
  ) return error("NOT_FOUND", 404);
  if (!environment.LOCAL_RESEND_WEBHOOK_SECRET.startsWith("whsec_")) {
    return error("SERVICE_UNAVAILABLE", 503);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    !== "application/json") return error("INVALID_REQUEST", 415);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BODY_BYTES) {
    return error("INVALID_REQUEST", 413);
  }
  const rawInput = await request.text();
  if (new TextEncoder().encode(rawInput).byteLength > MAXIMUM_BODY_BYTES) {
    return error("INVALID_REQUEST", 413);
  }
  let unknownInput: unknown;
  try {
    unknownInput = JSON.parse(rawInput);
  } catch {
    return error("INVALID_REQUEST", 400);
  }
  const parsed = inputSchema.safeParse(unknownInput);
  const rawCapability = capability(request);
  if (!parsed.success || !rawCapability) return error("NOT_FOUND", 404);

  const capabilityHash = await sha256Hex(new TextEncoder().encode(rawCapability));
  const attempt = await environment.RELEASE_DB.prepare(`
    SELECT da.provider_message_id
    FROM delivery_attempts da
    JOIN temporary_releases tr ON tr.transaction_id = da.transaction_id
    WHERE da.transaction_id = ? AND da.recipient_role = ?
      AND da.delivery_state IN ('ACCEPTED', 'DELAYED', 'DELIVERED', 'FAILED')
      AND da.provider_message_id IS NOT NULL
      AND tr.status_capability_hash = ? AND tr.cleanup_started_at IS NULL
      AND tr.expires_at > ?
    ORDER BY da.attempt_number DESC LIMIT 1
  `).bind(match[1], parsed.data.recipientRole, capabilityHash, now).first<AttemptRow>();
  if (!attempt) return error("NOT_FOUND", 404);

  const webhookBody = JSON.stringify({
    type: parsed.data.eventType,
    created_at: new Date(now).toISOString(),
    data: { email_id: attempt.provider_message_id },
  });
  const svixId = `local_${crypto.randomUUID()}`;
  const timestamp = new Date(now);
  const webhookRequest = new Request(`${url.origin}/webhooks/resend`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": svixId,
      "svix-timestamp": String(Math.floor(now / 1_000)),
      "svix-signature": new Webhook(environment.LOCAL_RESEND_WEBHOOK_SECRET).sign(
        svixId, timestamp, webhookBody,
      ),
    },
    body: webhookBody,
  });
  try {
    const result = await processResendWebhookRequest(
      environment.RELEASE_DB,
      webhookRequest,
      environment.LOCAL_RESEND_WEBHOOK_SECRET,
      now,
    );
    if (result.outcome !== "applied") return error("EVENT_NOT_APPLIED", 409);
    return Response.json({
      outcome: "applied",
      recipientRole: result.recipientRole,
      deliveryState: result.deliveryState,
      releaseState: result.releaseState,
    }, { headers: NO_STORE_HEADERS });
  } catch {
    return error("SERVICE_UNAVAILABLE", 503);
  }
}

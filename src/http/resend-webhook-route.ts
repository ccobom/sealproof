import {
  processResendWebhookRequest,
  ResendWebhookBodyError,
} from "../delivery/process-resend-webhook";
import { ResendWebhookError } from "../delivery/verify-resend-webhook";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

export interface ResendWebhookEnvironment {
  RELEASE_DB: D1Database;
  EXPECTED_HOSTNAME: string;
  RESEND_WEBHOOK_SECRET: string;
}

function error(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: NO_STORE_HEADERS });
}

export async function handleResendWebhookRequest(
  request: Request,
  environment: ResendWebhookEnvironment,
  receivedAt: number = Date.now(),
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { ...NO_STORE_HEADERS, allow: "POST" },
    });
  }
  const url = new URL(request.url);
  if (
    url.protocol !== "https:"
    || url.hostname !== environment.EXPECTED_HOSTNAME
    || url.pathname !== "/api/webhooks/resend"
    || url.search !== ""
  ) return error("NOT_FOUND", 404);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    !== "application/json") return error("INVALID_REQUEST", 415);
  if (!/^whsec_[A-Za-z0-9+/=_-]{16,512}$/.test(environment.RESEND_WEBHOOK_SECRET)) {
    return error("SERVICE_UNAVAILABLE", 503);
  }
  if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) {
    return error("SERVICE_UNAVAILABLE", 503);
  }

  try {
    await processResendWebhookRequest(
      environment.RELEASE_DB,
      request,
      environment.RESEND_WEBHOOK_SECRET,
      receivedAt,
    );
    return Response.json({ received: true }, { headers: NO_STORE_HEADERS });
  } catch (caught) {
    if (caught instanceof ResendWebhookBodyError) {
      return error(
        caught.code === "PAYLOAD_TOO_LARGE" ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
        caught.code === "PAYLOAD_TOO_LARGE" ? 413 : 400,
      );
    }
    if (caught instanceof ResendWebhookError) {
      const authenticationFailure = caught.code === "MISSING_HEADERS"
        || caught.code === "INVALID_SIGNATURE";
      return error(authenticationFailure ? "INVALID_SIGNATURE" : "INVALID_EVENT", authenticationFailure ? 401 : 400);
    }
    return error("SERVICE_UNAVAILABLE", 503);
  }
}

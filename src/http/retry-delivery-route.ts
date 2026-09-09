import { z } from "zod";
import { sha256Hex } from "../document/hash";
import { recomputeDeliverySummary } from "../delivery/recompute-delivery-summary";
import type { DeliveryRecipientRole } from "../delivery/delivery-provider";
import { MAXIMUM_DELIVERY_ATTEMPTS_PER_ROLE } from "../delivery/state";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;
const MAXIMUM_BODY_BYTES = 64;
const inputSchema = z.strictObject({
  recipientRole: z.enum(["PRODUCTION", "SIGNER"]),
});

interface AttemptRow {
  id: number;
  attempt_number: number;
  delivery_state: string;
}

export interface RetryDeliveryEnvironment {
  RELEASE_DB: D1Database;
  EXPECTED_HOSTNAME: string;
}

export interface RetryDeliveryNotification {
  transactionId: string;
  recipientRole: DeliveryRecipientRole;
  requestedAt: number;
  publicOrigin: string;
}

export type RetryDeliveryHandler = (
  notification: RetryDeliveryNotification,
  environment: RetryDeliveryEnvironment,
) => Promise<void>;

function error(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: NO_STORE_HEADERS });
}

function bearer(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return undefined;
  const capability = value.slice("Bearer ".length);
  return /^[A-Za-z0-9_-]{43}$/.test(capability) ? capability : undefined;
}

async function latestAttempt(
  db: D1Database,
  transactionId: string,
  role: DeliveryRecipientRole,
): Promise<AttemptRow | null> {
  return db.prepare(`
    SELECT id, attempt_number, delivery_state FROM delivery_attempts
    WHERE transaction_id = ? AND recipient_role = ?
    ORDER BY attempt_number DESC LIMIT 1
  `).bind(transactionId, role).first<AttemptRow>();
}

export async function handleRetryDeliveryRequest(
  request: Request,
  environment: RetryDeliveryEnvironment,
  now: number = Date.now(),
  submitRetry?: RetryDeliveryHandler,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...NO_STORE_HEADERS, allow: "POST" } });
  }
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/releases\/([A-Za-z0-9_-]{16,128})\/retry$/);
  if (
    url.protocol !== "https:" || url.hostname !== environment.EXPECTED_HOSTNAME
    || request.headers.get("origin") !== url.origin || !match
    || !Number.isSafeInteger(now) || now < 0
  ) return error("NOT_FOUND", 404);
  if (!submitRetry) return error("SERVICE_UNAVAILABLE", 503);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    !== "application/json") return error("INVALID_REQUEST", 415);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BODY_BYTES) {
    return error("INVALID_REQUEST", 413);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAXIMUM_BODY_BYTES) {
    return error("INVALID_REQUEST", 413);
  }
  let unknownInput: unknown;
  try {
    unknownInput = JSON.parse(rawBody);
  } catch {
    return error("INVALID_REQUEST", 400);
  }
  const parsed = inputSchema.safeParse(unknownInput);
  const capability = bearer(request);
  if (!parsed.success || !capability) return error("NOT_FOUND", 404);
  const transactionId = match[1];
  const role = parsed.data.recipientRole;
  const capabilityHash = await sha256Hex(new TextEncoder().encode(capability));
  const authorized = await environment.RELEASE_DB.prepare(`
    SELECT 1 AS allowed FROM temporary_releases tr
    JOIN audit_releases ar ON ar.transaction_id = tr.transaction_id
    WHERE tr.transaction_id = ? AND tr.download_capability_hash = ?
      AND tr.cleanup_started_at IS NULL AND tr.expires_at > ?
      AND ar.release_state IN ('DELIVERY_FAILED', 'SEALED_AWAITING_DELIVERY')
  `).bind(transactionId, capabilityHash, now).first();
  if (!authorized) return error("NOT_FOUND", 404);

  let latest = await latestAttempt(environment.RELEASE_DB, transactionId, role);
  if (!latest) return error("NOT_FOUND", 404);
  if (latest.delivery_state === "FAILED") {
    if (latest.attempt_number >= MAXIMUM_DELIVERY_ATTEMPTS_PER_ROLE) {
      return error("RETRY_LIMIT_REACHED", 409);
    }
    try {
      await environment.RELEASE_DB.prepare(`
        INSERT INTO delivery_attempts (
          transaction_id, recipient_role, attempt_number, delivery_state, created_at
        ) SELECT ?, ?, ?, 'PENDING_SUBMISSION', ?
        WHERE EXISTS (
          SELECT 1 FROM delivery_attempts
          WHERE id = ? AND delivery_state = 'FAILED'
        )
      `).bind(transactionId, role, latest.attempt_number + 1, now, latest.id).run();
    } catch {
      // A concurrent request may have created the uniquely numbered attempt.
    }
    latest = await latestAttempt(environment.RELEASE_DB, transactionId, role);
  }
  if (!latest || latest.attempt_number < 2
    || !["PENDING_SUBMISSION", "ACCEPTED"].includes(latest.delivery_state)) {
    return error("NOT_RETRYABLE", 409);
  }

  await recomputeDeliverySummary(environment.RELEASE_DB, transactionId);
  if (latest.delivery_state === "PENDING_SUBMISSION") {
    try {
      await submitRetry({
        transactionId,
        recipientRole: role,
        requestedAt: now,
        publicOrigin: url.origin,
      }, environment);
    } catch {
      // Keep the durable pending attempt recoverable; never claim provider acceptance.
    }
    latest = await latestAttempt(environment.RELEASE_DB, transactionId, role);
  }
  await recomputeDeliverySummary(environment.RELEASE_DB, transactionId);
  return Response.json({
    outcome: latest?.delivery_state === "ACCEPTED" ? "accepted" : "pending",
    recipientRole: role,
    attemptNumber: latest?.attempt_number ?? 2,
  }, {
    status: latest?.delivery_state === "ACCEPTED" ? 200 : 202,
    headers: NO_STORE_HEADERS,
  });
}

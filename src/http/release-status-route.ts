import { sha256Hex } from "../document/hash";
import { MAXIMUM_DELIVERY_ATTEMPTS_PER_ROLE } from "../delivery/state";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

interface StatusRow {
  document_hash: string;
  release_state: "FINALIZING" | "SEALED_AWAITING_DELIVERY" | "DELIVERED" | "DELIVERY_FAILED" | "DELIVERY_UNRESOLVED";
  production_delivery_outcome: "PENDING" | "DELIVERED" | "FAILED" | "UNRESOLVED";
  signer_delivery_outcome: "PENDING" | "DELIVERED" | "FAILED" | "UNRESOLVED";
  failure_category: string | null;
  expires_at: number;
  production_attempts: number;
  signer_attempts: number;
}

export interface ReleaseStatusEnvironment {
  RELEASE_DB: D1Database;
  EXPECTED_HOSTNAME: string;
}

function hiddenNotFound(): Response {
  return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE_HEADERS });
}

function bearerCapability(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return undefined;
  const capability = value.slice("Bearer ".length);
  return /^[A-Za-z0-9_-]{43}$/.test(capability) ? capability : undefined;
}

export async function handleReleaseStatusRequest(
  request: Request,
  environment: ReleaseStatusEnvironment,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { ...NO_STORE_HEADERS, allow: "GET" } });
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers: NO_STORE_HEADERS });
  }
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/releases\/([A-Za-z0-9_-]{16,128})\/status$/);
  const capability = bearerCapability(request);
  if (url.protocol !== "https:" || url.hostname !== environment.EXPECTED_HOSTNAME || !match || !capability) {
    return hiddenNotFound();
  }
  const capabilityHash = await sha256Hex(new TextEncoder().encode(capability));
  const row = await environment.RELEASE_DB.prepare(`
    SELECT ar.document_hash, ar.release_state, ar.production_delivery_outcome,
      ar.signer_delivery_outcome, ar.failure_category, tr.expires_at,
      (SELECT COUNT(*) FROM delivery_attempts da
        WHERE da.transaction_id = tr.transaction_id AND da.recipient_role = 'PRODUCTION')
        AS production_attempts,
      (SELECT COUNT(*) FROM delivery_attempts da
        WHERE da.transaction_id = tr.transaction_id AND da.recipient_role = 'SIGNER')
        AS signer_attempts
    FROM temporary_releases tr
    JOIN audit_releases ar ON ar.transaction_id = tr.transaction_id
    WHERE tr.transaction_id = ? AND tr.status_capability_hash = ?
      AND tr.cleanup_started_at IS NULL AND tr.expires_at > ?
      AND ar.release_state != 'CLOSED'
  `).bind(match[1], capabilityHash, now).first<StatusRow>();
  if (!row) return hiddenNotFound();

  return Response.json({
    transactionId: match[1],
    documentHash: row.document_hash,
    releaseState: row.release_state,
    productionDeliveryOutcome: row.production_delivery_outcome,
    signerDeliveryOutcome: row.signer_delivery_outcome,
    productionRetriesRemaining: Math.max(
      0, MAXIMUM_DELIVERY_ATTEMPTS_PER_ROLE - row.production_attempts,
    ),
    signerRetriesRemaining: Math.max(
      0, MAXIMUM_DELIVERY_ATTEMPTS_PER_ROLE - row.signer_attempts,
    ),
    failureCategory: row.failure_category,
    expiresAt: row.expires_at,
  }, { headers: NO_STORE_HEADERS });
}

import { cleanupRelease } from "../cleanup/release-cleanup";
import { sha256Hex } from "../document/hash";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

export interface CloseoutRouteEnvironment {
  RELEASE_DB: D1Database;
  RELEASE_DOCUMENTS: R2Bucket;
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

export async function handleCloseoutReleaseRequest(
  request: Request,
  environment: CloseoutRouteEnvironment,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== "DELETE") {
    return new Response(null, { status: 405, headers: { ...NO_STORE_HEADERS, allow: "DELETE" } });
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers: NO_STORE_HEADERS });
  }
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/releases\/([A-Za-z0-9_-]{16,128})$/);
  const capability = bearerCapability(request);
  if (
    url.protocol !== "https:" || url.hostname !== environment.EXPECTED_HOSTNAME
    || request.headers.get("origin") !== url.origin
    || !match || !capability
  ) return hiddenNotFound();
  if (request.headers.has("content-type") || Number(request.headers.get("content-length")) > 0) {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const transactionId = match[1];
  const capabilityHash = await sha256Hex(new TextEncoder().encode(capability));
  const authorized = await environment.RELEASE_DB.prepare(`
    SELECT 1 AS allowed FROM temporary_releases
    WHERE transaction_id = ? AND download_capability_hash = ?
      AND cleanup_started_at IS NULL AND expires_at > ?
  `).bind(transactionId, capabilityHash, now).first();
  if (!authorized) return hiddenNotFound();

  const result = await cleanupRelease(
    environment.RELEASE_DB,
    environment.RELEASE_DOCUMENTS,
    transactionId,
    "production_closeout",
    now,
  );
  if (result.outcome === "failed") {
    return Response.json({ error: "CLEANUP_INCOMPLETE" }, { status: 503, headers: NO_STORE_HEADERS });
  }
  if (result.outcome !== "completed" && result.outcome !== "already_completed") {
    return hiddenNotFound();
  }
  return Response.json({ outcome: "closed", transactionId }, { headers: NO_STORE_HEADERS });
}

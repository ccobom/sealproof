import { sha256Hex } from "../document/hash";
import { resumeReleaseFinalization } from "../release/finalize-release";
import type { SealedReleaseHandler, TicketFinalizationEnvironment } from "./ticket-finalization-route";

const HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

// Recovery is an explicit mutation authorized by the stronger closeout/download
// capability. It never creates a release, uploads bytes, or creates attempts.
export async function handleRecoverFinalizationRequest(
  request: Request,
  environment: TicketFinalizationEnvironment,
  now: number = Date.now(),
  afterSealed?: SealedReleaseHandler,
): Promise<Response> {
  const error = (code: string, status: number) => Response.json({ error: code }, { status, headers: HEADERS });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...HEADERS, allow: "POST" } });
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/releases\/([A-Za-z0-9_-]{16,128})\/recover$/);
  const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!match || !bearer || url.protocol !== "https:" || url.hostname !== environment.EXPECTED_HOSTNAME
    || request.headers.get("origin") !== url.origin) return error("NOT_FOUND", 404);
  if (!Number.isSafeInteger(now) || now < 0) return error("SERVICE_UNAVAILABLE", 503);
  if (environment.DELIVERY_ENABLED !== "true") return error("DELIVERY_UNAVAILABLE", 503);
  try {
    const hash = await sha256Hex(new TextEncoder().encode(bearer));
    const authorized = await environment.RELEASE_DB.prepare(`
      SELECT 1 FROM temporary_releases
      WHERE transaction_id = ? AND download_capability_hash = ?
        AND cleanup_started_at IS NULL AND expires_at > ?
    `).bind(match[1], hash, now).first();
    if (!authorized) return error("NOT_FOUND", 404);
    const result = await resumeReleaseFinalization(environment.RELEASE_DB, environment.RELEASE_DOCUMENTS, match[1], now);
    if (result.outcome === "not_resumable") return error("NOT_RESUMABLE", 409);
    if (result.outcome === "integrity_failure") return error("INTEGRITY_FAILURE", 409);
    if (result.outcome === "sealed" && afterSealed) {
      try {
        await afterSealed({ transactionId: match[1], publicOrigin: url.origin, sealedAt: now }, environment);
      } catch {
        // Sealing succeeded. Existing pending attempts remain manually retryable.
      }
    }
    return Response.json(result, { status: result.outcome === "waiting_for_pdf" ? 202 : 200, headers: HEADERS });
  } catch {
    return error("SERVICE_UNAVAILABLE", 503);
  }
}

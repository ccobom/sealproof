import { deliveryAvailable } from "../delivery/delivery-budget";
import { z } from "zod";
import { issueFinalizationTicket } from "./finalization-ticket";
import { verifyTurnstileToken } from "./verify-turnstile";

export const MAXIMUM_ADMISSION_REQUEST_BYTES = 4_096;
const TURNSTILE_ACTION = "release-finalization";
const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

const emailAddress = z.string().trim().max(254).pipe(z.email());
const admissionSchema = z.strictObject({
  productionEmail: emailAddress,
  signerEmail: emailAddress,
  browserDocumentHash: z.string().regex(/^[0-9a-f]{64}$/),
  turnstileToken: z.string().min(1).max(2_048),
});

export interface AdmissionRouteEnvironment {
  DELIVERY_ENABLED?: string;
  RELEASE_DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  EXPECTED_HOSTNAME: string;
  ACTIVE_WORKFLOW_VERSION: string;
  ACTIVE_TICKET_KEY_VERSION: string;
  TICKET_ENCRYPTION_KEY_BASE64: string;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function response(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: NO_STORE_HEADERS });
}

function decodeKey(value: string): Uint8Array | undefined {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
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

function validConfiguration(environment: AdmissionRouteEnvironment): boolean {
  return environment.TURNSTILE_SECRET_KEY.length >= 1
    && environment.TURNSTILE_SECRET_KEY.length <= 512
    && /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(environment.EXPECTED_HOSTNAME)
    && /^[A-Za-z0-9._-]{1,64}$/.test(environment.ACTIVE_WORKFLOW_VERSION)
    && /^[A-Za-z0-9_-]{1,128}$/.test(environment.ACTIVE_TICKET_KEY_VERSION)
    && decodeKey(environment.TICKET_ENCRYPTION_KEY_BASE64) !== undefined;
}

export async function handleAdmissionRequest(
  request: Request,
  environment: AdmissionRouteEnvironment,
  now: number = Date.now(),
  fetcher: Fetcher = fetch,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...NO_STORE_HEADERS, allow: "POST" } });
  }
  if (!await deliveryAvailable(environment, now)) return response("DELIVERY_UNAVAILABLE", 503);
  if (!validConfiguration(environment) || !Number.isSafeInteger(now) || now < 0) {
    return response("SERVICE_UNAVAILABLE", 503);
  }

  const url = new URL(request.url);
  if (
    url.protocol !== "https:"
    || url.hostname !== environment.EXPECTED_HOSTNAME
    || request.headers.get("origin") !== url.origin
  ) return response("INVALID_REQUEST", 400);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return response("INVALID_REQUEST", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_ADMISSION_REQUEST_BYTES) {
    return response("INVALID_REQUEST", 413);
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return response("INVALID_REQUEST", 400);
  }
  if (new TextEncoder().encode(text).byteLength > MAXIMUM_ADMISSION_REQUEST_BYTES) {
    return response("INVALID_REQUEST", 413);
  }
  let unknownBody: unknown;
  try {
    unknownBody = JSON.parse(text);
  } catch {
    return response("INVALID_REQUEST", 400);
  }
  const parsed = admissionSchema.safeParse(unknownBody);
  if (!parsed.success) return response("INVALID_REQUEST", 400);

  const verification = await verifyTurnstileToken(parsed.data.turnstileToken, {
    secretKey: environment.TURNSTILE_SECRET_KEY,
    expectedHostname: environment.EXPECTED_HOSTNAME,
    expectedAction: TURNSTILE_ACTION,
  }, fetcher);
  if (!verification.verified) {
    return verification.reason === "REJECTED"
      ? response("CHALLENGE_REJECTED", 403)
      : response("SERVICE_UNAVAILABLE", 503);
  }

  const key = decodeKey(environment.TICKET_ENCRYPTION_KEY_BASE64);
  if (!key) return response("SERVICE_UNAVAILABLE", 503);
  try {
    const issued = await issueFinalizationTicket({
      productionEmail: parsed.data.productionEmail,
      signerEmail: parsed.data.signerEmail,
      documentHash: parsed.data.browserDocumentHash,
    }, environment.ACTIVE_WORKFLOW_VERSION, environment.ACTIVE_TICKET_KEY_VERSION, key, now);
    return Response.json(issued, { status: 201, headers: NO_STORE_HEADERS });
  } catch {
    return response("SERVICE_UNAVAILABLE", 503);
  } finally {
    key.fill(0);
  }
}

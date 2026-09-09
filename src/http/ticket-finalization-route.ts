import { openFinalizationTicket } from "../admission/finalization-ticket";
import { FINAL_PDF_CONTRACT } from "../document/pdf-contract";
import { finalizeRelease } from "../release/finalize-release";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

export interface TicketFinalizationEnvironment {
  RELEASE_DB: D1Database;
  RELEASE_DOCUMENTS: R2Bucket;
  EXPECTED_HOSTNAME: string;
  ACTIVE_KEY_VERSION: string;
  KEY_ENCRYPTION_KEY_BASE64: string;
  ACTIVE_TICKET_KEY_VERSION: string;
  TICKET_ENCRYPTION_KEY_BASE64: string;
}

function error(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: NO_STORE_HEADERS });
}

function decodeKey(value: string): Uint8Array | undefined {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return undefined;
  try {
    const binary = atob(value);
    return binary.length === 32
      ? Uint8Array.from(binary, (character) => character.charCodeAt(0))
      : undefined;
  } catch {
    return undefined;
  }
}

function ticketFromAuthorization(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("SealProofTicket ")) return undefined;
  const ticket = value.slice("SealProofTicket ".length);
  return ticket.length >= 1 && ticket.length <= 2_048 ? ticket : undefined;
}

export async function handleTicketFinalizationRequest(
  request: Request,
  environment: TicketFinalizationEnvironment,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...NO_STORE_HEADERS, allow: "POST" } });
  }
  const pdfKey = decodeKey(environment.KEY_ENCRYPTION_KEY_BASE64);
  const ticketKey = decodeKey(environment.TICKET_ENCRYPTION_KEY_BASE64);
  if (
    !pdfKey || !ticketKey || !Number.isSafeInteger(now) || now < 0
    || !/^[A-Za-z0-9_-]{1,128}$/.test(environment.ACTIVE_KEY_VERSION)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(environment.ACTIVE_TICKET_KEY_VERSION)
  ) return error("SERVICE_UNAVAILABLE", 503);

  try {
    const url = new URL(request.url);
    if (
      url.protocol !== "https:" || url.hostname !== environment.EXPECTED_HOSTNAME
      || request.headers.get("origin") !== url.origin
    ) return error("INVALID_REQUEST", 400);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/pdf") {
      return error("INVALID_PDF", 415);
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > FINAL_PDF_CONTRACT.maximumBytes) {
      return error("PDF_TOO_LARGE", 413);
    }
    const ticket = ticketFromAuthorization(request);
    if (!ticket) return error("INVALID_TICKET", 401);
    const opened = await openFinalizationTicket(
      ticket,
      { [environment.ACTIVE_TICKET_KEY_VERSION]: ticketKey },
      now,
    );
    if (!opened.valid) return error("INVALID_TICKET", 401);

    const pdfBytes = new Uint8Array(await request.arrayBuffer());
    if (pdfBytes.byteLength > FINAL_PDF_CONTRACT.maximumBytes) return error("PDF_TOO_LARGE", 413);
    const result = await finalizeRelease(environment.RELEASE_DB, environment.RELEASE_DOCUMENTS, {
      admissionId: opened.payload.admissionId,
      pdfBytes,
      browserDocumentHash: opened.payload.documentHash,
      workflowVersion: opened.payload.workflowVersion,
      emailAddresses: {
        productionEmail: opened.payload.productionEmail,
        signerEmail: opened.payload.signerEmail,
      },
      keyVersion: environment.ACTIVE_KEY_VERSION,
      keyEncryptionKey: pdfKey,
    }, () => now);

    if (result.outcome === "rejected") {
      if (result.reason === "ADMISSION_REPLAYED") return error("INVALID_TICKET", 401);
      return error(result.reason, result.reason === "PDF_TOO_LARGE" ? 413 : 400);
    }
    if (result.outcome === "storage_failed_cleaned") return error("SERVICE_UNAVAILABLE", 503);
    return Response.json({
      outcome: result.outcome,
      transactionId: result.transactionId,
      documentHash: result.documentHash,
      expiresAt: result.expiresAt,
      statusCapability: result.statusCapability,
      downloadCapability: result.downloadCapability,
    }, {
      status: result.outcome === "sealed" ? 201 : 202,
      headers: NO_STORE_HEADERS,
    });
  } finally {
    pdfKey.fill(0);
    ticketKey.fill(0);
  }
}

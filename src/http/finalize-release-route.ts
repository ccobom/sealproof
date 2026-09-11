import { FINAL_PDF_CONTRACT } from "../document/pdf-contract";
import { finalizeRelease } from "../release/finalize-release";
import { parseFinalizationMetadata } from "./finalization-metadata";

export const MAXIMUM_FINALIZATION_REQUEST_BYTES = 3_100_000;

export interface FinalizationRouteEnvironment {
  RELEASE_DB: D1Database;
  RELEASE_DOCUMENTS: R2Bucket;
  ACTIVE_WORKFLOW_VERSION: string;
  ACTIVE_KEY_VERSION: string;
  KEY_ENCRYPTION_KEY_BASE64: string;
}

type PublicErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_METADATA_JSON"
  | "INVALID_METADATA"
  | "METADATA_TOO_LARGE"
  | "INVALID_PDF"
  | "PDF_TOO_LARGE"
  | "HASH_MISMATCH"
  | "SERVICE_UNAVAILABLE";

function errorResponse(code: PublicErrorCode, status: number): Response {
  return Response.json({ error: code }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function decodeKey(base64: string): Uint8Array | undefined {
  try {
    const binary = atob(base64);
    if (binary.length !== 32) return undefined;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function validConfigurationIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

export async function handleFinalizeReleaseRequest(
  request: Request,
  environment: FinalizationRouteEnvironment,
  now: () => number = Date.now,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" },
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse("INVALID_REQUEST", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_FINALIZATION_REQUEST_BYTES) {
    return errorResponse("PDF_TOO_LARGE", 413);
  }

  const keyEncryptionKey = decodeKey(environment.KEY_ENCRYPTION_KEY_BASE64);
  if (
    !keyEncryptionKey
    || !validConfigurationIdentifier(environment.ACTIVE_WORKFLOW_VERSION)
    || !validConfigurationIdentifier(environment.ACTIVE_KEY_VERSION)
  ) {
    return errorResponse("SERVICE_UNAVAILABLE", 503);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("INVALID_REQUEST", 400);
  }

  const keys = [...form.keys()];
  if (
    keys.some((key) => key !== "document" && key !== "metadata")
    || form.getAll("document").length !== 1
    || form.getAll("metadata").length !== 1
  ) {
    return errorResponse("INVALID_REQUEST", 400);
  }

  const document = form.get("document");
  const serializedMetadata = form.get("metadata");
  if (!(document instanceof File) || typeof serializedMetadata !== "string") {
    return errorResponse("INVALID_REQUEST", 400);
  }
  if (document.type !== "application/pdf") {
    return errorResponse("INVALID_PDF", 415);
  }
  if (document.size > FINAL_PDF_CONTRACT.maximumBytes) {
    return errorResponse("PDF_TOO_LARGE", 413);
  }

  const metadata = parseFinalizationMetadata(serializedMetadata);
  if (!metadata.valid) return errorResponse(metadata.reason, 400);

  const result = await finalizeRelease(
    environment.RELEASE_DB,
    environment.RELEASE_DOCUMENTS,
    {
      pdfBytes: new Uint8Array(await document.arrayBuffer()),
      browserDocumentHash: metadata.metadata.browserDocumentHash,
      workflowVersion: environment.ACTIVE_WORKFLOW_VERSION,
      emailAddresses: {
        productionEmail: metadata.metadata.productionEmail,
        signerEmail: metadata.metadata.signerEmail,
      },
      keyVersion: environment.ACTIVE_KEY_VERSION,
      keyEncryptionKey,
    },
    now,
  );

  if (result.outcome === "rejected") {
    if (result.reason === "DELIVERY_UNAVAILABLE") return errorResponse("SERVICE_UNAVAILABLE", 503);
    if (result.reason === "ADMISSION_REPLAYED") {
      return errorResponse("INVALID_REQUEST", 400);
    }
    return errorResponse(result.reason, result.reason === "PDF_TOO_LARGE" ? 413 : 400);
  }
  if (result.outcome === "storage_failed_cleaned") {
    return errorResponse("SERVICE_UNAVAILABLE", 503);
  }

  return Response.json({
    outcome: result.outcome,
    transactionId: result.transactionId,
    documentHash: result.documentHash,
    expiresAt: result.expiresAt,
    statusCapability: result.statusCapability,
    downloadCapability: result.downloadCapability,
  }, {
    status: result.outcome === "sealed" ? 201 : 202,
    headers: { "cache-control": "no-store" },
  });
}

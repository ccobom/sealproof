import { z } from "zod";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const capabilitySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const admissionResponseSchema = z.strictObject({
  ticket: z.string().min(1).max(2_048),
  expiresAt: z.number().int().positive().safe(),
});

const finalizationResponseSchema = z.strictObject({
  outcome: z.enum(["sealed", "pending_recovery"]),
  transactionId: z.uuid(),
  documentHash: hashSchema,
  expiresAt: z.number().int().positive().safe(),
  statusCapability: capabilitySchema,
  downloadCapability: capabilitySchema,
});

const statusResponseSchema = z.strictObject({
  transactionId: z.uuid(),
  documentHash: hashSchema,
  releaseState: z.enum(["FINALIZING", "SEALED_AWAITING_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "DELIVERY_UNRESOLVED"]),
  productionDeliveryOutcome: z.enum(["PENDING", "DELIVERED", "FAILED", "UNRESOLVED"]),
  signerDeliveryOutcome: z.enum(["PENDING", "DELIVERED", "FAILED", "UNRESOLVED"]),
  failureCategory: z.enum([
    "delivery_bounced",
    "provider_submission_failed",
    "expired_delivery_unresolved",
    "conflicting_provider_events",
    "cleanup_failed",
    "unknown_failure",
  ]).nullable(),
  expiresAt: z.number().int().positive().safe(),
});

const closeoutResponseSchema = z.strictObject({
  outcome: z.literal("closed"),
  transactionId: z.uuid(),
});

export interface AdmissionInput {
  productionEmail: string;
  signerEmail: string;
  browserDocumentHash: string;
  turnstileToken: string;
}

export type Admission = z.infer<typeof admissionResponseSchema>;
export type FinalizedRelease = z.infer<typeof finalizationResponseSchema>;
export type ReleaseStatus = z.infer<typeof statusResponseSchema>;
export type FinalizationFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PrivateBrowserRequestInit = RequestInit & {
  credentials: "omit";
};

export class FinalizationRequestError extends Error {
  constructor(
    readonly stage: "admission" | "upload" | "status" | "closeout",
    readonly status: number | undefined,
  ) {
    super(`SealProof ${stage} request failed`);
    this.name = "FinalizationRequestError";
  }
}

async function parsedJson(
  response: Response,
  stage: FinalizationRequestError["stage"],
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new FinalizationRequestError(stage, response.status);
  }
}

export async function requestFinalizationAdmission(
  input: AdmissionInput,
  fetcher: FinalizationFetcher = fetch,
): Promise<Admission> {
  const request: PrivateBrowserRequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  };
  const response = await fetcher("/api/releases/admissions", request);
  if (!response.ok) throw new FinalizationRequestError("admission", response.status);
  const parsed = admissionResponseSchema.safeParse(await parsedJson(response, "admission"));
  if (!parsed.success) throw new FinalizationRequestError("admission", response.status);
  return parsed.data;
}

export async function requestReleaseStatus(
  release: Pick<FinalizedRelease, "transactionId" | "documentHash" | "statusCapability">,
  fetcher: FinalizationFetcher = fetch,
): Promise<ReleaseStatus> {
  const request: PrivateBrowserRequestInit = {
    method: "GET",
    headers: { authorization: `Bearer ${release.statusCapability}` },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  };
  const response = await fetcher(`/api/releases/${release.transactionId}/status`, request);
  if (!response.ok) throw new FinalizationRequestError("status", response.status);
  const parsed = statusResponseSchema.safeParse(await parsedJson(response, "status"));
  if (
    !parsed.success
    || parsed.data.transactionId !== release.transactionId
    || parsed.data.documentHash !== release.documentHash
  ) throw new FinalizationRequestError("status", response.status);
  return parsed.data;
}

export async function closeoutRelease(
  release: Pick<FinalizedRelease, "transactionId" | "downloadCapability">,
  fetcher: FinalizationFetcher = fetch,
): Promise<void> {
  const request: PrivateBrowserRequestInit = {
    method: "DELETE",
    headers: { authorization: `Bearer ${release.downloadCapability}` },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  };
  const response = await fetcher(`/api/releases/${release.transactionId}`, request);
  if (!response.ok) throw new FinalizationRequestError("closeout", response.status);
  const parsed = closeoutResponseSchema.safeParse(await parsedJson(response, "closeout"));
  if (!parsed.success || parsed.data.transactionId !== release.transactionId) {
    throw new FinalizationRequestError("closeout", response.status);
  }
}

export async function uploadReviewedPdf(
  pdfBytes: Uint8Array,
  expectedDocumentHash: string,
  ticket: string,
  fetcher: FinalizationFetcher = fetch,
): Promise<FinalizedRelease> {
  const request: PrivateBrowserRequestInit = {
    method: "POST",
    headers: {
      authorization: `SealProofTicket ${ticket}`,
      "content-type": "application/pdf",
    },
    body: Uint8Array.from(pdfBytes).buffer,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  };
  const response = await fetcher("/api/releases/finalize", request);
  if (!response.ok) throw new FinalizationRequestError("upload", response.status);
  let unknownResponse: unknown;
  try {
    unknownResponse = await response.json();
  } catch {
    throw new FinalizationRequestError("upload", response.status);
  }
  const parsed = finalizationResponseSchema.safeParse(unknownResponse);
  if (!parsed.success || parsed.data.documentHash !== expectedDocumentHash) {
    throw new FinalizationRequestError("upload", response.status);
  }
  return parsed.data;
}

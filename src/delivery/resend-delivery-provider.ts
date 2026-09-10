import { z } from "zod";
import type {
  DeliveryProvider,
  DeliverySubmission,
  DeliverySubmissionReceipt,
} from "./delivery-provider";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const MAXIMUM_RESPONSE_BYTES = 16_384;

const ResendSuccess = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
}).strict();

const ResendErrorBody = z.object({
  name: z.string().max(128).optional(),
}).passthrough();

export type ResendFailureCategory =
  | "AUTHENTICATION"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "MALFORMED_RESPONSE";

export class ResendDeliveryError extends Error {
  constructor(
    readonly category: ResendFailureCategory,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Resend delivery failed: ${category}`);
    this.name = "ResendDeliveryError";
  }
}

type NetworkFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ResendDeliveryProviderConfiguration {
  apiKey: string;
  from: string;
  fetcher?: NetworkFetcher;
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw || !/^\d{1,5}$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return seconds <= 86_400 ? seconds : undefined;
}

function classifyFailure(
  status: number,
  providerName: string | undefined,
): { category: ResendFailureCategory; retryable: boolean } {
  if (status === 401 || status === 403) {
    return { category: "AUTHENTICATION", retryable: false };
  }
  if (status === 429) {
    const quotaExceeded = providerName === "daily_quota_exceeded"
      || providerName === "monthly_quota_exceeded";
    return { category: "RATE_LIMITED", retryable: !quotaExceeded };
  }
  if (status >= 500) return { category: "PROVIDER_UNAVAILABLE", retryable: true };
  return { category: "INVALID_REQUEST", retryable: false };
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > MAXIMUM_RESPONSE_BYTES) {
    throw new ResendDeliveryError("MALFORMED_RESPONSE", true);
  }
  if (!response.body) throw new ResendDeliveryError("MALFORMED_RESPONSE", true);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ResendDeliveryError("MALFORMED_RESPONSE", true);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes)) as unknown;
  } catch {
    throw new ResendDeliveryError("MALFORMED_RESPONSE", true);
  }
}

export class ResendDeliveryProvider implements DeliveryProvider {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetcher: NetworkFetcher;

  constructor(configuration: ResendDeliveryProviderConfiguration) {
    if (!/^re_[A-Za-z0-9_\-]{8,256}$/.test(configuration.apiKey)) {
      throw new Error("Invalid Resend API key configuration");
    }
    if (configuration.from.length < 3 || configuration.from.length > 320
      || /[\r\n]/.test(configuration.from)) {
      throw new Error("Invalid Resend sender configuration");
    }
    this.#apiKey = configuration.apiKey;
    this.#from = configuration.from;
    this.#fetcher = configuration.fetcher ?? ((input, init) => fetch(input, init));
  }

  async submit(input: DeliverySubmission): Promise<DeliverySubmissionReceipt> {
    let response: Response;
    try {
      response = await this.#fetcher(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
          "user-agent": "SealProof/1.0",
        },
        body: JSON.stringify({
          from: this.#from,
          to: [input.recipientEmail],
          subject: "Your sealed release from SealProof",
          text: [
            "Your sealed release is attached.",
            "",
            `Document SHA-256: ${input.documentHash}`,
            "Keep this email and attachment for your records.",
          ].join("\n"),
          attachments: [{
            path: input.attachmentUrl,
            filename: input.attachmentFilename,
          }],
        }),
      });
    } catch (error) {
      if (error instanceof ResendDeliveryError) throw error;
      throw new ResendDeliveryError("PROVIDER_UNAVAILABLE", true);
    }

    const body = await boundedJson(response);
    if (!response.ok) {
      const providerName = ResendErrorBody.safeParse(body);
      const failure = classifyFailure(
        response.status,
        providerName.success ? providerName.data.name : undefined,
      );
      throw new ResendDeliveryError(
        failure.category,
        failure.retryable,
        response.status === 429 ? retryAfterSeconds(response) : undefined,
      );
    }

    const parsed = ResendSuccess.safeParse(body);
    if (!parsed.success) throw new ResendDeliveryError("MALFORMED_RESPONSE", true);
    return { providerMessageId: parsed.data.id };
  }
}

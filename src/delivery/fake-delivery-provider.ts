import { sha256Hex } from "../document/hash";
import type {
  DeliveryProvider,
  DeliverySubmission,
  DeliverySubmissionReceipt,
} from "./delivery-provider";

type AttachmentFetcher = (request: Request) => Promise<Response>;

export interface FakeDeliveryEvidence {
  recipientRole: DeliverySubmission["recipientRole"];
  documentHash: string;
  attachmentBytes: number;
  providerMessageId: string;
}

export class FakeDeliveryProvider implements DeliveryProvider {
  readonly evidence: FakeDeliveryEvidence[] = [];
  readonly #receipts = new Map<string, { fingerprint: string; receipt: DeliverySubmissionReceipt }>();

  constructor(private readonly fetchAttachment: AttachmentFetcher) {}

  async submit(input: DeliverySubmission): Promise<DeliverySubmissionReceipt> {
    const fingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({
      recipientRole: input.recipientRole,
      recipientEmail: input.recipientEmail,
      attachmentUrl: input.attachmentUrl,
      attachmentFilename: input.attachmentFilename,
      documentHash: input.documentHash,
    })));
    const existing = this.#receipts.get(input.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
      return existing.receipt;
    }

    const response = await this.fetchAttachment(new Request(input.attachmentUrl));
    if (!response.ok || response.headers.get("content-type") !== "application/pdf") {
      throw new Error("ATTACHMENT_RETRIEVAL_FAILED");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualHash = await sha256Hex(bytes);
    if (
      actualHash !== input.documentHash
      || response.headers.get("x-sealproof-sha256") !== input.documentHash
    ) throw new Error("ATTACHMENT_IDENTITY_MISMATCH");

    const providerMessageId = `fake_${(await sha256Hex(
      new TextEncoder().encode(input.idempotencyKey),
    )).slice(0, 32)}`;
    const receipt = { providerMessageId };
    this.#receipts.set(input.idempotencyKey, { fingerprint, receipt });
    this.evidence.push({
      recipientRole: input.recipientRole,
      documentHash: actualHash,
      attachmentBytes: bytes.byteLength,
      providerMessageId,
    });
    bytes.fill(0);
    return receipt;
  }
}

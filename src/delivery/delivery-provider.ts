export type DeliveryRecipientRole = "PRODUCTION" | "SIGNER";

export interface DeliverySubmission {
  recipientRole: DeliveryRecipientRole;
  recipientEmail: string;
  attachmentUrl: string;
  attachmentFilename: "sealproof-release.pdf";
  documentHash: string;
  idempotencyKey: string;
}

export interface DeliverySubmissionReceipt {
  providerMessageId: string;
}

export interface DeliveryProvider {
  submit(input: DeliverySubmission): Promise<DeliverySubmissionReceipt>;
}

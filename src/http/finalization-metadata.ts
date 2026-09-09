import { z } from "zod";

export const MAXIMUM_FINALIZATION_METADATA_BYTES = 2_048;

const emailAddress = z.string()
  .trim()
  .max(254)
  .pipe(z.email());

export const finalizationMetadataSchema = z.strictObject({
  productionEmail: emailAddress,
  signerEmail: emailAddress,
  browserDocumentHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type FinalizationMetadata = z.infer<typeof finalizationMetadataSchema>;

export type FinalizationMetadataFailure =
  | "INVALID_METADATA_JSON"
  | "INVALID_METADATA"
  | "METADATA_TOO_LARGE";

export type ParseFinalizationMetadataResult =
  | { valid: true; metadata: FinalizationMetadata }
  | { valid: false; reason: FinalizationMetadataFailure };

export function parseFinalizationMetadata(
  serializedMetadata: string,
): ParseFinalizationMetadataResult {
  if (new TextEncoder().encode(serializedMetadata).byteLength > MAXIMUM_FINALIZATION_METADATA_BYTES) {
    return { valid: false, reason: "METADATA_TOO_LARGE" };
  }

  let untrustedValue: unknown;
  try {
    untrustedValue = JSON.parse(serializedMetadata);
  } catch {
    return { valid: false, reason: "INVALID_METADATA_JSON" };
  }

  const result = finalizationMetadataSchema.safeParse(untrustedValue);
  if (!result.success) return { valid: false, reason: "INVALID_METADATA" };
  return { valid: true, metadata: result.data };
}

import { PDFDocument } from "pdf-lib";

export const FINAL_PDF_CONTRACT = {
  maximumBytes: 3_000_000,
  maximumPages: 3,
} as const;

export type PdfContractFailure =
  | "INVALID_PDF"
  | "PDF_TOO_LARGE"
  | "TOO_MANY_PAGES";

export type PdfContractResult =
  | { valid: true; pageCount: number }
  | { valid: false; reason: PdfContractFailure };

export type PdfUploadFailure = "INVALID_PDF" | "PDF_TOO_LARGE";

export type PdfUploadResult =
  | { valid: true }
  | { valid: false; reason: PdfUploadFailure };

// This is the deliberately small Worker trust boundary. It does not claim to
// prove that the bytes are a structurally valid PDF; the remote CPU spike
// showed that full pdf-lib parsing is not reliable within the Free CPU budget.
export function validatePdfUpload(bytes: Uint8Array): PdfUploadResult {
  if (bytes.byteLength > FINAL_PDF_CONTRACT.maximumBytes) {
    return { valid: false, reason: "PDF_TOO_LARGE" };
  }
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    return { valid: false, reason: "INVALID_PDF" };
  }
  return { valid: true };
}

// The reviewed browser generator uses this before signer preview/finalization.
export async function validateFinalPdf(bytes: Uint8Array): Promise<PdfContractResult> {
  const upload = validatePdfUpload(bytes);
  if (!upload.valid) return upload;

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch {
    return { valid: false, reason: "INVALID_PDF" };
  }

  const pageCount = document.getPageCount();
  if (pageCount < 1) return { valid: false, reason: "INVALID_PDF" };
  if (pageCount > FINAL_PDF_CONTRACT.maximumPages) {
    return { valid: false, reason: "TOO_MANY_PAGES" };
  }
  return { valid: true, pageCount };
}

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

export async function validateFinalPdf(bytes: Uint8Array): Promise<PdfContractResult> {
  if (bytes.byteLength > FINAL_PDF_CONTRACT.maximumBytes) {
    return { valid: false, reason: "PDF_TOO_LARGE" };
  }
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    return { valid: false, reason: "INVALID_PDF" };
  }

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

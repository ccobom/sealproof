import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  FINAL_PDF_CONTRACT,
  validateFinalPdf,
  validatePdfUpload,
} from "../../src/document/pdf-contract";

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage();
  return document.save({ useObjectStreams: false });
}

function padTo(bytes: Uint8Array, size: number): Uint8Array {
  const result = new Uint8Array(size);
  result.set(bytes);
  return result;
}

describe("final PDF contract", () => {
  it("accepts one through three pages and rejects four", async () => {
    for (let pages = 1; pages <= FINAL_PDF_CONTRACT.maximumPages; pages += 1) {
      await expect(validateFinalPdf(await makePdf(pages))).resolves.toEqual({
        valid: true,
        pageCount: pages,
      });
    }
    await expect(validateFinalPdf(await makePdf(4))).resolves.toEqual({
      valid: false,
      reason: "TOO_MANY_PAGES",
    });
  });

  it("accepts the exact byte ceiling and rejects one byte above it", async () => {
    const onePage = await makePdf(1);
    const exact = padTo(onePage, FINAL_PDF_CONTRACT.maximumBytes);
    const over = padTo(onePage, FINAL_PDF_CONTRACT.maximumBytes + 1);

    await expect(validateFinalPdf(exact)).resolves.toEqual({ valid: true, pageCount: 1 });
    await expect(validateFinalPdf(over)).resolves.toEqual({
      valid: false,
      reason: "PDF_TOO_LARGE",
    });
  });

  it("rejects malformed bytes even when they mimic a PDF header", async () => {
    await expect(validateFinalPdf(
      new TextEncoder().encode("%PDF-this is not a document"),
    )).resolves.toEqual({ valid: false, reason: "INVALID_PDF" });
  });
});

describe("Worker PDF upload boundary", () => {
  it("enforces byte size and header without claiming full parsing", async () => {
    const fourPages = await makePdf(4);
    expect(validatePdfUpload(fourPages)).toEqual({ valid: true });
    expect(validatePdfUpload(
      new TextEncoder().encode("%PDF-header-only synthetic bytes"),
    )).toEqual({ valid: true });
    expect(validatePdfUpload(new TextEncoder().encode("not a PDF"))).toEqual({
      valid: false,
      reason: "INVALID_PDF",
    });
    expect(validatePdfUpload(new Uint8Array(FINAL_PDF_CONTRACT.maximumBytes + 1))).toEqual({
      valid: false,
      reason: "PDF_TOO_LARGE",
    });
  });
});

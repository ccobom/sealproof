import photoBytes from "../../src/spike/fixtures/synthetic-photo.jpg";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createRepresentativeReleaseDocument } from "../../src/document/create-representative-release";
import { IMAGE_CONTRACT, validateJpegPhoto } from "../../src/document/image-contract";
import { FINAL_PDF_CONTRACT, validateFinalPdf } from "../../src/document/pdf-contract";
import { SIGNATURE_CONTRACT, type Signature } from "../../src/document/signature-contract";
import { makeSyntheticSignature } from "../../src/spike/synthetic-signature";

function maximumPointSignature(): Signature {
  return Array.from({ length: 8 }, (_, strokeIndex) =>
    Array.from({ length: SIGNATURE_CONTRACT.maximumPointsPerStroke }, (_, pointIndex) => ({
      x: pointIndex / (SIGNATURE_CONTRACT.maximumPointsPerStroke - 1),
      y: 0.1 + (strokeIndex / 10) + 0.04 * Math.sin(pointIndex / 5),
    })),
  );
}

function boundarySizedJpeg(source: Uint8Array): Uint8Array {
  const result = new Uint8Array(IMAGE_CONTRACT.photo.maximumBytes);
  result.set(source);
  return result;
}

describe("representative PDF size", () => {
  it("measures a realistic multi-page release", async () => {
    const photo = new Uint8Array(photoBytes);
    const pdf = await createRepresentativeReleaseDocument({
      photo,
      signature: makeSyntheticSignature(),
    });
    const parsed = await PDFDocument.load(pdf);

    console.info(JSON.stringify({
      measurement: "representative-pdf",
      photoBytes: photo.byteLength,
      signaturePoints: 130,
      pages: parsed.getPageCount(),
      pdfBytes: pdf.byteLength,
    }));
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(pdf.byteLength).toBeGreaterThan(photo.byteLength);
    expect(await validateFinalPdf(pdf)).toEqual({ valid: true, pageCount: 3 });
  });

  it("measures the approved photo and signature contract boundary", async () => {
    const photo = boundarySizedJpeg(new Uint8Array(photoBytes));
    expect(validateJpegPhoto(photo)).toEqual({ width: 1280, height: 960 });
    const signature = maximumPointSignature();
    const pdf = await createRepresentativeReleaseDocument({ photo, signature });
    const parsed = await PDFDocument.load(pdf);

    console.info(JSON.stringify({
      measurement: "boundary-pdf",
      photoBytes: photo.byteLength,
      signaturePoints: SIGNATURE_CONTRACT.maximumTotalPoints,
      pages: parsed.getPageCount(),
      pdfBytes: pdf.byteLength,
    }));
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(pdf.byteLength).toBeGreaterThan(photo.byteLength);
    expect(pdf.byteLength).toBeLessThanOrEqual(FINAL_PDF_CONTRACT.maximumBytes);
    expect(await validateFinalPdf(pdf)).toEqual({ valid: true, pageCount: 3 });
  });
});

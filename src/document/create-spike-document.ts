import { LineCapStyle, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { validateJpegPhoto } from "./image-contract";
import {
  signatureToSvgPath,
  type Signature,
} from "./signature-contract";

export interface SpikeInputs {
  photo: Uint8Array;
  signature: Signature;
}

export async function createSpikeDocument(images: SpikeInputs): Promise<Uint8Array> {
  validateJpegPhoto(images.photo);

  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const photo = await document.embedJpg(images.photo);

  page.drawText("SEALPROOF RELEASE — TECHNICAL SPIKE", {
    x: 54,
    y: 730,
    size: 16,
    font: bold,
    color: rgb(0.08, 0.12, 0.18),
  });
  page.drawText("All names, contact information, and images in this file are synthetic.", {
    x: 54,
    y: 704,
    size: 9,
    font: regular,
  });
  page.drawText("Project: Worker PDF and SHA-256 validation", {
    x: 54,
    y: 670,
    size: 11,
    font: regular,
  });
  page.drawText("Release text: This is not a contract and contains no personal data.", {
    x: 54,
    y: 648,
    size: 11,
    font: regular,
  });
  page.drawText("Synthetic photo", { x: 54, y: 608, size: 10, font: bold });
  page.drawImage(photo, { x: 54, y: 436, width: 224, height: 168 });
  page.drawText("Synthetic vector signature", { x: 54, y: 400, size: 10, font: bold });
  page.drawSvgPath(signatureToSvgPath(images.signature, 300, 80), {
    x: 54,
    y: 406,
    borderColor: rgb(0.1, 0.13, 0.18),
    borderWidth: 1.5,
    borderLineCap: LineCapStyle.Round,
  });

  return document.save({ useObjectStreams: false });
}

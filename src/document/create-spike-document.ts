import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface SpikeImages {
  photo: Uint8Array;
  signature: Uint8Array;
}

export async function createSpikeDocument(images: SpikeImages): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const photo = await document.embedPng(images.photo);
  const signature = await document.embedPng(images.signature);

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
  page.drawText("Synthetic signature", { x: 54, y: 400, size: 10, font: bold });
  page.drawImage(signature, { x: 54, y: 326, width: 300, height: 80 });

  return document.save({ useObjectStreams: false });
}

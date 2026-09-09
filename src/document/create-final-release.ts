import { LineCapStyle, PDFDocument, type PDFFont, StandardFonts, rgb } from "pdf-lib";
import { productionSetupSchema, type ProductionSetup } from "../app/production-setup";
import { signerDetailsSchema, type SignerDetails } from "../app/signer-details";
import { validateJpegPhoto } from "./image-contract";
import { signatureToSvgPath, validateSignature, type Signature } from "./signature-contract";

export interface FinalReleaseInput {
  setup: ProductionSetup;
  signer: SignerDetails;
  releaseText: string;
  photo?: Uint8Array;
  signature: Signature;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function footer(page: ReturnType<PDFDocument["addPage"]>, bold: PDFFont, pageNumber: number) {
  page.drawText("TEST CONTENT ONLY — NOT A LEGAL AGREEMENT", {
    x: MARGIN,
    y: 28,
    size: 8,
    font: bold,
    color: rgb(0.68, 0.12, 0.1),
  });
  page.drawText(`Page ${pageNumber} of 2`, { x: 500, y: 28, size: 8, font: bold });
}

export async function createFinalReleaseDocument(input: FinalReleaseInput): Promise<Uint8Array> {
  const setup = productionSetupSchema.parse(input.setup);
  const signer = signerDetailsSchema.parse(input.signer);
  validateSignature(input.signature);
  if (setup.photoRequired && !input.photo) throw new Error("A required signer photo is missing");
  if (input.photo) validateJpegPhoto(input.photo);

  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  const agreementPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  footer(agreementPage, bold, 1);
  agreementPage.drawText("SEALPROOF — LOCAL FINAL TEST PDF", {
    x: MARGIN, y: 730, size: 18, font: bold, color: rgb(0.08, 0.1, 0.15),
  });

  const fields = [
    ["Production / producer", setup.productionName],
    ["Signature collection by", setup.signatureCollector || setup.productionName],
    ["Production email", setup.productionEmail],
    ["Project", setup.projectTitle],
    ["Signer", signer.signerName],
    ["Signer email", signer.signerEmail],
    ["Agreement date", signer.signedDate],
    ["Signer photograph", input.photo ? "Included" : "Waived by production"],
  ] as const;

  let y = 690;
  for (const [label, value] of fields) {
    agreementPage.drawText(`${label}:`, { x: MARGIN, y, size: 9, font: bold });
    const valueLines = wrapText(value, regular, 9, 330);
    valueLines.forEach((line, index) => {
      agreementPage.drawText(line, { x: 205, y: y - index * 12, size: 9, font: regular });
    });
    y -= Math.max(20, valueLines.length * 12 + 5);
  }

  y -= 8;
  agreementPage.drawText("Release reviewed and agreed to by signer", {
    x: MARGIN, y, size: 11, font: bold,
  });
  y -= 20;
  for (const line of wrapText(input.releaseText, regular, 10, PAGE_WIDTH - 2 * MARGIN)) {
    if (y < 52) throw new Error("Release text does not fit within the approved final PDF layout");
    if (line) agreementPage.drawText(line, { x: MARGIN, y, size: 10, font: regular });
    y -= 14;
  }

  const evidencePage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  footer(evidencePage, bold, 2);
  evidencePage.drawText("SIGNER EVIDENCE — LOCAL TEST", {
    x: MARGIN, y: 730, size: 18, font: bold,
  });
  evidencePage.drawText(`Signer: ${signer.signerName}`, { x: MARGIN, y: 700, size: 10, font: regular });
  evidencePage.drawText(`Date: ${signer.signedDate}`, { x: MARGIN, y: 682, size: 10, font: regular });

  if (input.photo) {
    const embeddedPhoto = await document.embedJpg(input.photo);
    const scale = Math.min(330 / embeddedPhoto.width, 330 / embeddedPhoto.height);
    evidencePage.drawText("Current signer photograph", { x: MARGIN, y: 650, size: 10, font: bold });
    evidencePage.drawImage(embeddedPhoto, {
      x: MARGIN,
      y: 300,
      width: embeddedPhoto.width * scale,
      height: embeddedPhoto.height * scale,
    });
  } else {
    evidencePage.drawRectangle({
      x: MARGIN, y: 430, width: PAGE_WIDTH - 2 * MARGIN, height: 170,
      borderColor: rgb(0.35, 0.4, 0.37), borderWidth: 1,
    });
    evidencePage.drawText("NO SIGNER PHOTOGRAPH", { x: 190, y: 525, size: 14, font: bold });
    evidencePage.drawText("Photograph requirement waived by production before signer handoff.", {
      x: 125, y: 500, size: 9, font: regular,
    });
  }

  evidencePage.drawText("Drawn vector signature", { x: MARGIN, y: 255, size: 10, font: bold });
  evidencePage.drawLine({
    start: { x: MARGIN, y: 125 }, end: { x: PAGE_WIDTH - MARGIN, y: 125 },
    thickness: 0.75, color: rgb(0.45, 0.48, 0.46),
  });
  evidencePage.drawSvgPath(signatureToSvgPath(input.signature, 420, 100), {
    x: MARGIN,
    y: 230,
    borderColor: rgb(0.08, 0.1, 0.15),
    borderWidth: 1.4,
    borderLineCap: LineCapStyle.Round,
  });
  evidencePage.drawText("Captured locally after affirmative agreement; not yet uploaded or sealed.", {
    x: MARGIN, y: 95, size: 8, font: regular, color: rgb(0.3, 0.32, 0.36),
  });

  return document.save({ useObjectStreams: false });
}

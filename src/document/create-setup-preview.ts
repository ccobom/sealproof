import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import type { ProductionSetup } from "../app/production-setup";

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

export async function createSetupPreviewDocument(
  setup: ProductionSetup,
  releaseText: string,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  page.drawText("SEALPROOF — LOCAL TEST PREVIEW", {
    x: MARGIN, y: 728, size: 18, font: bold, color: rgb(0.08, 0.1, 0.15),
  });
  page.drawText("TEST CONTENT ONLY — NOT A LEGAL AGREEMENT", {
    x: MARGIN, y: 704, size: 9, font: bold, color: rgb(0.68, 0.12, 0.1),
  });

  const fields = [
    ["Production / producer", setup.productionName],
    ["Signature collection by", setup.signatureCollector || setup.productionName],
    ["Production email", setup.productionEmail],
    ["Project", setup.projectTitle],
    ["Agreement date", setup.agreementDate],
    ["Signer photograph", setup.photoRequired ? "Required" : "Waived by production"],
  ] as const;

  let y = 662;
  for (const [label, value] of fields) {
    page.drawText(label, { x: MARGIN, y, size: 9, font: bold });
    page.drawText(value, { x: 190, y, size: 9, font: regular });
    y -= 22;
  }

  y -= 10;
  for (const line of wrapText(releaseText, regular, 10, PAGE_WIDTH - 2 * MARGIN)) {
    if (line) page.drawText(line, { x: MARGIN, y, size: 10, font: regular });
    y -= 15;
  }

  page.drawText("Generated locally in this browser. Nothing was uploaded, stored, emailed, or sealed.", {
    x: MARGIN, y: 28, size: 8, font: regular, color: rgb(0.3, 0.32, 0.36),
  });

  return document.save({ useObjectStreams: false });
}

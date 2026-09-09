import { LineCapStyle, PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { validateJpegPhoto } from "./image-contract";
import { signatureToSvgPath, type Signature } from "./signature-contract";

export interface RepresentativeReleaseInput {
  photo: Uint8Array;
  signature: Signature;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const BODY_SIZE = 10;
const LINE_HEIGHT = 14;

const TEST_SECTIONS = [
  "Purpose of this test document. This synthetic text exists only to reproduce the approximate length, wrapping, headings, and page count of a production release. It is not legal language and must never be presented for agreement.",
  "Project context. The example describes a fictional recorded-media project with ordinary production details, intended uses, distribution contexts, and administrative information. Every person, company, address, and title is invented for software testing.",
  "Participation description. This paragraph reserves enough space for a clear description of an appearance, contribution, interview, performance, or other participation that a real release might discuss. It grants no rights and creates no obligations.",
  "Media description. A production release may refer to photographs, audio recordings, video recordings, names, voices, likenesses, performances, and related materials. This test lists those categories only to exercise typography and line wrapping.",
  "Permitted-use placeholder. Representative release documents often explain editing, reproduction, exhibition, distribution, publicity, advertising, archival, and promotional uses. This is deliberately non-operative test content and not an authorization.",
  "Territory and duration placeholder. A real agreement may contain geographic and time-related terms. Those choices require separate product and legal review; this paragraph merely occupies representative space in the generated PDF.",
  "Compensation placeholder. Real releases may describe whether compensation exists and whether additional approvals are required. No compensation term is asserted here. This section is synthetic and included only for layout measurement.",
  "Representations placeholder. A final form may contain statements about age, authority, voluntary participation, accuracy, or third-party rights. None of those statements are adopted by this technical fixture.",
  "Privacy notice placeholder. The production version must accurately disclose collection, temporary processing, email delivery, storage, deletion, and service-provider involvement. This test text does not substitute for that disclosure.",
  "Electronic process placeholder. The product may explain that the signer reviews the exact generated document, provides a photograph and drawn signature, and receives the same sealed PDF and integrity hash as production.",
  "Delivery placeholder. The product distinguishes provider acceptance from delivery to a recipient mail server and does not claim that a person opened or read an email. This paragraph supplies realistic explanatory length.",
  "Integrity placeholder. SealProof calculates a SHA-256 value over the finalized PDF bytes. The hash can help identify later byte changes, but it does not independently prove identity, comprehension, or legal enforceability.",
  "Retention placeholder. Access to SealProof-controlled temporary PDF and personal information ends at two hours; recurring cleanup then retries deletion until confirmed. Explicit closeout deletes sooner. External provider retention must be disclosed separately.",
  "Failure placeholder. If delivery fails, the production representative may retry the affected role using the same stored bytes or choose an approved download-and-delete path before the unchanged expiration deadline.",
  "Final review placeholder. A production document must use reviewed language and clearly identify the agreement presented to the signer. TEST CONTENT ONLY remains on every page of this fixture so it cannot plausibly be mistaken for that document.",
] as const;

function addPage(document: PDFDocument, bold: PDFFont): PDFPage {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawText("TEST CONTENT ONLY - NOT A LEGAL AGREEMENT", {
    x: MARGIN,
    y: 28,
    size: 8,
    font: bold,
    color: rgb(0.65, 0.08, 0.08),
  });
  return page;
}

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function createRepresentativeReleaseDocument(
  input: RepresentativeReleaseInput,
): Promise<Uint8Array> {
  validateJpegPhoto(input.photo);
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const photo = await document.embedJpg(input.photo);

  let page = addPage(document, bold);
  page.drawText("SEALPROOF REPRESENTATIVE SIZE FIXTURE", {
    x: MARGIN,
    y: 730,
    size: 16,
    font: bold,
  });
  page.drawText("Production company: Synthetic Long-Form Production Company LLC", {
    x: MARGIN, y: 696, size: BODY_SIZE, font: regular,
  });
  page.drawText("Project: A Fictional Documentary Project With a Representative Long Title", {
    x: MARGIN, y: 678, size: BODY_SIZE, font: regular,
  });
  page.drawText("Signer: Synthetic Test Participant", {
    x: MARGIN, y: 660, size: BODY_SIZE, font: regular,
  });
  page.drawText("Date: September 8, 2026", {
    x: MARGIN, y: 642, size: BODY_SIZE, font: regular,
  });

  let y = 602;
  for (const [index, section] of TEST_SECTIONS.entries()) {
    const heading = `Synthetic section ${index + 1}`;
    const lines = wrapText(section, regular, BODY_SIZE, PAGE_WIDTH - 2 * MARGIN);
    const needed = 20 + lines.length * LINE_HEIGHT + 12;
    if (y - needed < 52) {
      page = addPage(document, bold);
      y = 730;
    }
    page.drawText(heading, { x: MARGIN, y, size: 11, font: bold });
    y -= 18;
    for (const line of lines) {
      page.drawText(line, { x: MARGIN, y, size: BODY_SIZE, font: regular });
      y -= LINE_HEIGHT;
    }
    y -= 12;
  }

  page = addPage(document, bold);
  page.drawText("Synthetic identity evidence and signature", {
    x: MARGIN,
    y: 730,
    size: 14,
    font: bold,
  });
  const photoScale = Math.min(360 / photo.width, 360 / photo.height);
  page.drawImage(photo, {
    x: MARGIN,
    y: 330,
    width: photo.width * photoScale,
    height: photo.height * photoScale,
  });
  page.drawText("Synthetic vector signature", {
    x: MARGIN, y: 292, size: 10, font: bold,
  });
  page.drawSvgPath(signatureToSvgPath(input.signature, 420, 100), {
    x: MARGIN,
    y: 280,
    borderColor: rgb(0.08, 0.1, 0.15),
    borderWidth: 1.25,
    borderLineCap: LineCapStyle.Round,
  });

  return document.save({ useObjectStreams: false });
}

import photoBytes from "../../src/spike/fixtures/synthetic-photo.jpg";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createFinalReleaseDocument, type FinalReleaseInput } from "../../src/document/create-final-release";
import { sha256Hex } from "../../src/document/hash";
import { validateFinalPdf } from "../../src/document/pdf-contract";
import { makeSyntheticSignature } from "../../src/spike/synthetic-signature";
import { SYNTHETIC_RELEASE_TEXT } from "../../src/app/production-setup";

function validInput(): FinalReleaseInput {
  return {
    setup: {
      productionName: "Synthetic Production LLC",
      signatureCollector: "Synthetic Producer",
      productionEmail: "producer@example.invalid",
      projectTitle: "Synthetic Test Project",
      agreementDate: "2026-09-09",
      photoRequired: true,
    },
    signer: {
      signerName: "Synthetic Signer",
      signerEmail: "signer@example.invalid",
      signedDate: "2026-09-09",
      agreed: true,
    },
    releaseText: SYNTHETIC_RELEASE_TEXT,
    photo: new Uint8Array(photoBytes),
    signature: makeSyntheticSignature(),
  };
}

describe("local final release document", () => {
  it("creates and hashes the exact two-page PDF with a photo", async () => {
    const bytes = await createFinalReleaseDocument(validInput());
    const parsed = await PDFDocument.load(bytes);

    expect(parsed.getPageCount()).toBe(2);
    expect(await validateFinalPdf(bytes)).toEqual({ valid: true, pageCount: 2 });
    expect(await sha256Hex(bytes)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records the approved no-photo branch without embedding a photo", async () => {
    const input = validInput();
    input.setup.photoRequired = false;
    input.photo = undefined;

    const bytes = await createFinalReleaseDocument(input);
    expect(await validateFinalPdf(bytes)).toEqual({ valid: true, pageCount: 2 });
  });

  it("rejects a missing photo when production required one", async () => {
    const input = validInput();
    input.photo = undefined;
    await expect(createFinalReleaseDocument(input)).rejects.toThrow("required signer photo is missing");
  });
});

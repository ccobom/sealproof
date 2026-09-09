import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { productionSetupSchema, SYNTHETIC_RELEASE_TEXT, todayForDateInput } from "../../src/app/production-setup";
import { createSetupPreviewDocument } from "../../src/document/create-setup-preview";
import { validateFinalPdf } from "../../src/document/pdf-contract";

const VALID_SETUP = {
  productionName: "Synthetic Production LLC",
  signatureCollector: "Synthetic Producer",
  productionEmail: "producer@example.invalid",
  projectTitle: "Synthetic Test Project",
  agreementDate: "2026-09-09",
  photoRequired: true,
};

describe("production setup preview", () => {
  it("validates the approved fields and rejects unknown product behavior", () => {
    expect(productionSetupSchema.safeParse(VALID_SETUP).success).toBe(true);
    expect(productionSetupSchema.safeParse({ ...VALID_SETUP, editableReleaseText: "not approved" }).success)
      .toBe(false);
  });

  it("generates a readable PDF within the browser contract", async () => {
    const bytes = await createSetupPreviewDocument(VALID_SETUP, SYNTHETIC_RELEASE_TEXT);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(1);
    expect(await validateFinalPdf(bytes)).toEqual({ valid: true, pageCount: 1 });
  });

  it("formats the local calendar date for the date input", () => {
    expect(todayForDateInput(new Date("2026-01-02T12:00:00Z"))).toMatch(/^2026-01-0[12]$/);
  });
});

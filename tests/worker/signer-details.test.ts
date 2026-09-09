import { describe, expect, it } from "vitest";
import { signerDetailsSchema } from "../../src/app/signer-details";

const VALID_SIGNER = {
  signerName: "Synthetic Signer",
  signerEmail: "signer@example.invalid",
  signedDate: "2026-09-09",
  agreed: true,
};

describe("signer review boundary", () => {
  it("accepts the exact approved signer fields", () => {
    expect(signerDetailsSchema.parse(VALID_SIGNER)).toEqual(VALID_SIGNER);
  });

  it("requires explicit agreement and valid identity fields", () => {
    expect(signerDetailsSchema.safeParse({ ...VALID_SIGNER, agreed: false }).success).toBe(false);
    expect(signerDetailsSchema.safeParse({ ...VALID_SIGNER, signerName: "" }).success).toBe(false);
    expect(signerDetailsSchema.safeParse({ ...VALID_SIGNER, signerEmail: "invalid" }).success).toBe(false);
    expect(signerDetailsSchema.safeParse({ ...VALID_SIGNER, signedDate: "September 9" }).success).toBe(false);
  });

  it("rejects hidden or future signer fields", () => {
    expect(signerDetailsSchema.safeParse({ ...VALID_SIGNER, typedSignature: "not approved" }).success)
      .toBe(false);
  });
});

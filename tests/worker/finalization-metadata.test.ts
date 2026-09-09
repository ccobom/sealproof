import { describe, expect, it } from "vitest";
import {
  MAXIMUM_FINALIZATION_METADATA_BYTES,
  parseFinalizationMetadata,
} from "../../src/http/finalization-metadata";

const HASH = "a".repeat(64);

function serialize(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    productionEmail: "producer@example.invalid",
    signerEmail: "signer@example.invalid",
    browserDocumentHash: HASH,
    ...overrides,
  });
}

describe("finalization metadata boundary", () => {
  it("accepts exactly the public fields and trims surrounding email whitespace", () => {
    expect(parseFinalizationMetadata(serialize({
      productionEmail: "  producer@example.invalid ",
    }))).toEqual({
      valid: true,
      metadata: {
        productionEmail: "producer@example.invalid",
        signerEmail: "signer@example.invalid",
        browserDocumentHash: HASH,
      },
    });
  });

  it("rejects malformed JSON with a stable public reason", () => {
    expect(parseFinalizationMetadata("{"))
      .toEqual({ valid: false, reason: "INVALID_METADATA_JSON" });
  });

  it("rejects missing, mistyped, invalid, and unexpected fields", () => {
    const cases = [
      JSON.stringify({ signerEmail: "signer@example.invalid", browserDocumentHash: HASH }),
      serialize({ productionEmail: 47 }),
      serialize({ signerEmail: "not-an-email" }),
      serialize({ browserDocumentHash: "A".repeat(64) }),
      serialize({ workflowVersion: "client-selected" }),
      JSON.stringify(["not", "an", "object"]),
      "null",
    ];

    for (const value of cases) {
      expect(parseFinalizationMetadata(value)).toEqual({
        valid: false,
        reason: "INVALID_METADATA",
      });
    }
  });

  it("rejects metadata above its byte ceiling before JSON parsing", () => {
    const oversized = "{" + " ".repeat(MAXIMUM_FINALIZATION_METADATA_BYTES);
    expect(new TextEncoder().encode(oversized).byteLength)
      .toBeGreaterThan(MAXIMUM_FINALIZATION_METADATA_BYTES);
    expect(parseFinalizationMetadata(oversized)).toEqual({
      valid: false,
      reason: "METADATA_TOO_LARGE",
    });
  });

  it("accepts otherwise valid metadata at the exact byte ceiling", () => {
    const valid = serialize();
    const exact = valid + " ".repeat(MAXIMUM_FINALIZATION_METADATA_BYTES - valid.length);
    expect(new TextEncoder().encode(exact).byteLength)
      .toBe(MAXIMUM_FINALIZATION_METADATA_BYTES);
    expect(parseFinalizationMetadata(exact)).toMatchObject({ valid: true });
  });

  it("measures the ceiling in encoded bytes rather than JavaScript characters", () => {
    const multibyte = `"${"é".repeat(1_024)}"`;
    expect(multibyte.length).toBeLessThanOrEqual(MAXIMUM_FINALIZATION_METADATA_BYTES);
    expect(parseFinalizationMetadata(multibyte)).toEqual({
      valid: false,
      reason: "METADATA_TOO_LARGE",
    });
  });
});

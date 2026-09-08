import { describe, expect, it } from "vitest";
import {
  signatureToSvgPath,
  validateSignature,
  type Signature,
} from "../../src/document/signature-contract";
import { makeSyntheticSignature } from "../../src/spike/synthetic-signature";

describe("signature contract", () => {
  it("accepts bounded normalized strokes and converts them to a path", () => {
    const signature = makeSyntheticSignature();

    expect(() => validateSignature(signature)).not.toThrow();
    expect(signatureToSvgPath(signature, 300, 80)).toMatch(/^M .+ L .+ M .+ L /);
  });

  it("rejects coordinates outside the normalized drawing area", () => {
    const signature: Signature = [[{ x: 0, y: 0 }, { x: 1.01, y: 1 }]];
    expect(() => validateSignature(signature)).toThrow(
      "point coordinates must be between zero and one",
    );
  });

  it("rejects non-finite coordinates", () => {
    const signature: Signature = [[{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }]];
    expect(() => validateSignature(signature)).toThrow(
      "point coordinates must be finite numbers",
    );
  });

  it("rejects signatures with too many strokes", () => {
    const signature: Signature = Array.from({ length: 21 }, () => [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(() => validateSignature(signature)).toThrow("too many strokes");
  });

  it("rejects strokes with too many points", () => {
    const signature: Signature = [
      Array.from({ length: 251 }, (_, index) => ({
        x: index / 250,
        y: 0.5,
      })),
    ];
    expect(() => validateSignature(signature)).toThrow(
      "a stroke contains too many points",
    );
  });
});

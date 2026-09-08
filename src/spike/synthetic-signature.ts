import type { Signature } from "../document/signature-contract";

export function makeSyntheticSignature(): Signature {
  const primaryStroke = Array.from({ length: 80 }, (_, index) => ({
    x: index / 79,
    y: 0.45 + 0.2 * Math.sin(index / 7),
  }));
  const flourish = Array.from({ length: 50 }, (_, index) => ({
    x: 0.25 + (index / 49) * 0.7,
    y: 0.65 + 0.08 * Math.sin(index / 3),
  }));

  return [primaryStroke, flourish];
}

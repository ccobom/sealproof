export const SIGNATURE_CONTRACT = {
  maximumStrokes: 20,
  maximumPointsPerStroke: 250,
  maximumTotalPoints: 2_000,
} as const;

export interface SignaturePoint {
  x: number;
  y: number;
}

export type SignatureStroke = SignaturePoint[];
export type Signature = SignatureStroke[];

function fail(message: string): never {
  throw new Error(`Invalid signature: ${message}`);
}

export function validateSignature(signature: Signature): void {
  if (!Array.isArray(signature) || signature.length < 1) fail("at least one stroke is required");
  if (signature.length > SIGNATURE_CONTRACT.maximumStrokes) fail("too many strokes");

  let totalPoints = 0;
  for (const stroke of signature) {
    if (!Array.isArray(stroke) || stroke.length < 2) fail("each stroke requires at least two points");
    if (stroke.length > SIGNATURE_CONTRACT.maximumPointsPerStroke) {
      fail("a stroke contains too many points");
    }

    totalPoints += stroke.length;
    if (totalPoints > SIGNATURE_CONTRACT.maximumTotalPoints) fail("too many total points");

    for (const point of stroke) {
      if (
        typeof point?.x !== "number" ||
        typeof point?.y !== "number" ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      ) {
        fail("point coordinates must be finite numbers");
      }
      if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
        fail("point coordinates must be between zero and one");
      }
    }
  }
}

export function signatureToSvgPath(
  signature: Signature,
  width: number,
  height: number,
): string {
  validateSignature(signature);

  return signature
    .map((stroke) =>
      stroke
        .map((point, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command} ${(point.x * width).toFixed(2)} ${(point.y * height).toFixed(2)}`;
        })
        .join(" "),
    )
    .join(" ");
}

export const IMAGE_CONTRACT = {
  photo: {
    format: "jpeg",
    maximumBytes: 40_000,
    maximumLongestEdge: 1_280,
    captureLongestEdge: 640,
    targetBytes: 35_000,
    captureLongestEdges: [640, 560, 480],
  },
} as const;

export interface ImageDimensions {
  width: number;
  height: number;
}

export function containedPhotoDimensions(width: number, height: number): ImageDimensions {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("Camera returned invalid frame dimensions");
  }
  const scale = Math.min(1, IMAGE_CONTRACT.photo.captureLongestEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function photoCaptureDimensionPlan(width: number, height: number): ImageDimensions[] {
  const initial = containedPhotoDimensions(width, height);
  const initialLongestEdge = Math.max(initial.width, initial.height);
  const smallerDimensions = IMAGE_CONTRACT.photo.captureLongestEdges
    .filter((longestEdge) => longestEdge < initialLongestEdge)
    .map((longestEdge) => {
      const scale = longestEdge / initialLongestEdge;
      return {
        width: Math.max(1, Math.round(initial.width * scale)),
        height: Math.max(1, Math.round(initial.height * scale)),
      };
    });
  return [initial, ...smallerDimensions];
}

function fail(message: string): never {
  throw new Error(`Invalid spike image: ${message}`);
}

export function validateJpegPhoto(bytes: Uint8Array): ImageDimensions {
  if (bytes.length > IMAGE_CONTRACT.photo.maximumBytes) fail("photo exceeds 40 KB");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("photo is not a JPEG");

  let offset = 2;
  let dimensions: ImageDimensions | undefined;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) fail("malformed JPEG marker");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) fail("truncated JPEG segment");

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      fail("invalid JPEG segment length");
    }
    if (marker === 0xe1) fail("photo contains prohibited EXIF metadata");

    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isStartOfFrame) {
      if (segmentLength < 7) fail("truncated JPEG dimensions");
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width < 1 || height < 1) fail("invalid JPEG dimensions");
      if (Math.max(width, height) > IMAGE_CONTRACT.photo.maximumLongestEdge) {
        fail("photo edge exceeds 1280 pixels");
      }
      dimensions = { width, height };
    }

    offset += segmentLength;
  }

  return dimensions ?? fail("JPEG dimensions were not found");
}

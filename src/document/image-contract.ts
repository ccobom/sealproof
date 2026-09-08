export const IMAGE_CONTRACT = {
  photo: {
    format: "jpeg",
    maximumBytes: 2_000_000,
    maximumLongestEdge: 1_280,
  },
} as const;

export interface ImageDimensions {
  width: number;
  height: number;
}

function fail(message: string): never {
  throw new Error(`Invalid spike image: ${message}`);
}

export function validateJpegPhoto(bytes: Uint8Array): ImageDimensions {
  if (bytes.length > IMAGE_CONTRACT.photo.maximumBytes) fail("photo exceeds 2 MB");
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

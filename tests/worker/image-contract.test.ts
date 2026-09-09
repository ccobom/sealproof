import { describe, expect, it } from "vitest";
import syntheticPhotoBuffer from "../../src/spike/fixtures/synthetic-photo.jpg";
import {
  containedPhotoDimensions,
  validateJpegPhoto,
} from "../../src/document/image-contract";

describe("image contract", () => {
  it("preserves aspect ratio while bounding the longest browser edge", () => {
    expect(containedPhotoDimensions(4032, 3024)).toEqual({ width: 1280, height: 960 });
    expect(containedPhotoDimensions(900, 1200)).toEqual({ width: 900, height: 1200 });
    expect(containedPhotoDimensions(640, 480)).toEqual({ width: 640, height: 480 });
    expect(() => containedPhotoDimensions(0, 480)).toThrow("invalid frame dimensions");
  });
  it("accepts the representative JPEG photo fixture", () => {
    expect(validateJpegPhoto(new Uint8Array(syntheticPhotoBuffer))).toEqual({
      width: 1280,
      height: 960,
    });
  });

  it("rejects a claimed photo that is not JPEG bytes", () => {
    expect(() => validateJpegPhoto(new Uint8Array([1, 2, 3]))).toThrow(
      "photo is not a JPEG",
    );
  });

  it("rejects JPEG application metadata before embedding", () => {
    const jpegWithApplicationMetadata = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x02,
      0xff, 0xd9,
    ]);

    expect(() => validateJpegPhoto(jpegWithApplicationMetadata)).toThrow(
      "prohibited EXIF metadata",
    );
  });

  it("rejects JPEG metadata even when it follows the dimensions", () => {
    const jpegWithLateApplicationMetadata = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x01, 0x00, 0x01,
      0xff, 0xe1, 0x00, 0x02,
      0xff, 0xd9,
    ]);

    expect(() => validateJpegPhoto(jpegWithLateApplicationMetadata)).toThrow(
      "prohibited EXIF metadata",
    );
  });
});

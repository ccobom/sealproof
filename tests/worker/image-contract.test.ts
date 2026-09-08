import { describe, expect, it } from "vitest";
import syntheticPhotoBuffer from "../../src/spike/fixtures/synthetic-photo.jpg";
import {
  validateJpegPhoto,
  validatePngSignature,
} from "../../src/document/image-contract";
import { makeSyntheticSignature } from "../../src/document/synthetic-images";

describe("image contract", () => {
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

  it("accepts the representative PNG signature fixture", () => {
    expect(validatePngSignature(makeSyntheticSignature())).toEqual({
      width: 300,
      height: 80,
    });
  });

  it("rejects a signature whose declared dimensions are too large", () => {
    const oversizedSignature = makeSyntheticSignature();
    oversizedSignature.set([0, 0, 3, 133], 16); // 901 pixels wide

    expect(() => validatePngSignature(oversizedSignature)).toThrow(
      "signature exceeds 900 by 300 pixels",
    );
  });
});

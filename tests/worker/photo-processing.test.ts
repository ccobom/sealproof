import { describe, expect, it } from "vitest";
import {
  CAPTURE_LONGEST_EDGES,
  photoCaptureDimensionPlan,
  TARGET_PHOTO_BYTES,
} from "../../src/app/photo-processing";
import { IMAGE_CONTRACT } from "../../src/document/image-contract";

describe("browser photo processing policy", () => {
  it("tries progressively smaller landscape and portrait frames", () => {
    expect(photoCaptureDimensionPlan(4032, 3024)).toEqual([
      { width: 640, height: 480 },
      { width: 560, height: 420 },
      { width: 480, height: 360 },
    ]);
    expect(photoCaptureDimensionPlan(3024, 4032)).toEqual([
      { width: 480, height: 640 },
      { width: 420, height: 560 },
      { width: 360, height: 480 },
    ]);
    expect(photoCaptureDimensionPlan(600, 450)).toEqual([
      { width: 600, height: 450 },
      { width: 560, height: 420 },
      { width: 480, height: 360 },
    ]);
  });

  it("keeps the encoding target below the hard photo boundary", () => {
    expect(CAPTURE_LONGEST_EDGES[CAPTURE_LONGEST_EDGES.length - 1]).toBe(480);
    expect(TARGET_PHOTO_BYTES).toBe(35_000);
    expect(IMAGE_CONTRACT.photo.maximumBytes).toBe(40_000);
    expect(TARGET_PHOTO_BYTES).toBeLessThan(IMAGE_CONTRACT.photo.maximumBytes);
  });
});

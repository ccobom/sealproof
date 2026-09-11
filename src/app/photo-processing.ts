import {
  IMAGE_CONTRACT,
  photoCaptureDimensionPlan,
  validateJpegPhoto,
} from "../document/image-contract";

export const TARGET_PHOTO_BYTES = IMAGE_CONTRACT.photo.targetBytes;
const JPEG_QUALITIES = [0.86, 0.78, 0.7, 0.62, 0.54] as const;

function canvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Browser could not encode the camera frame as JPEG"));
    }, "image/jpeg", quality);
  });
}

export async function capturePhotoFrame(video: HTMLVideoElement): Promise<Uint8Array> {
  const dimensionPlan = photoCaptureDimensionPlan(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Browser could not prepare the camera frame");

  let smallestBytes: Uint8Array | undefined;
  for (const dimensions of dimensionPlan) {
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
    for (const quality of JPEG_QUALITIES) {
      const bytes = new Uint8Array(await (await canvasJpeg(canvas, quality)).arrayBuffer());
      if (!smallestBytes || bytes.byteLength < smallestBytes.byteLength) smallestBytes = bytes;
      if (bytes.byteLength <= TARGET_PHOTO_BYTES) {
        validateJpegPhoto(bytes);
        return bytes;
      }
    }
  }
  if (!smallestBytes) throw new Error("Browser did not produce a photo");
  validateJpegPhoto(smallestBytes);
  return smallestBytes;
}

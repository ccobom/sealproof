import { containedPhotoDimensions, validateJpegPhoto } from "../document/image-contract";

export const TARGET_PHOTO_BYTES = 1_000_000;
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
  const dimensions = containedPhotoDimensions(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Browser could not prepare the camera frame");
  context.drawImage(video, 0, 0, dimensions.width, dimensions.height);

  let lastBytes: Uint8Array | undefined;
  for (const quality of JPEG_QUALITIES) {
    lastBytes = new Uint8Array(await (await canvasJpeg(canvas, quality)).arrayBuffer());
    if (lastBytes.byteLength <= TARGET_PHOTO_BYTES) break;
  }
  if (!lastBytes) throw new Error("Browser did not produce a photo");
  validateJpegPhoto(lastBytes);
  return lastBytes;
}

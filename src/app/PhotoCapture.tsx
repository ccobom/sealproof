import { useEffect, useRef, useState } from "react";
import { capturePhotoFrame } from "./photo-processing";

type FacingMode = "user" | "environment";
type CameraPhase = "idle" | "requesting" | "live" | "captured" | "error";

interface PhotoCaptureProps {
  onPhotoChange: (photo: Uint8Array | undefined) => void;
}

export function PhotoCapture({ onPhotoChange }: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream>();
  const photoUrlRef = useRef<string>();
  const [phase, setPhase] = useState<CameraPhase>("idle");
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [photoUrl, setPhotoUrl] = useState<string>();
  const [error, setError] = useState<string>();

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function discardPhoto() {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
    onPhotoChange(undefined);
  }

  useEffect(() => () => {
    stopCamera();
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
  }, []);

  async function startCamera(selectedFacingMode: FacingMode = facingMode) {
    stopCamera();
    setError(undefined);
    setPhase("requesting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not provide camera access. No photo was captured.");
      setPhase("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: selectedFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("Camera preview is unavailable");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setFacingMode(selectedFacingMode);
      setPhase("live");
    } catch {
      stopCamera();
      setError("SealProof could not access the camera. Check browser permission and try again.");
      setPhase("error");
    }
  }

  async function takePhoto() {
    if (!videoRef.current) return;
    try {
      const bytes = await capturePhotoFrame(videoRef.current);
      stopCamera();
      discardPhoto();
      const ownedBytes = new Uint8Array(bytes);
      const url = URL.createObjectURL(new Blob([ownedBytes.buffer as ArrayBuffer], { type: "image/jpeg" }));
      photoUrlRef.current = url;
      setPhotoUrl(url);
      onPhotoChange(ownedBytes);
      setPhase("captured");
    } catch {
      stopCamera();
      setError("SealProof could not create a valid photo. Nothing was saved; please try again.");
      setPhase("error");
    }
  }

  async function retake() {
    discardPhoto();
    await startCamera();
  }

  async function switchCamera() {
    const next = facingMode === "user" ? "environment" : "user";
    await startCamera(next);
  }

  return (
    <div className="camera" aria-live="polite">
      <div className="camera-frame">
        <video ref={videoRef} playsInline muted hidden={phase !== "live" && phase !== "requesting"} aria-label="Live camera preview" />
        {photoUrl && <img src={photoUrl} alt="Your captured signer photograph" />}
        {phase === "idle" && <p>Camera is off. It starts only when you choose to enable it.</p>}
        {phase === "requesting" && <p>Waiting for camera permission…</p>}
        {phase === "error" && <p className="camera-error" role="alert">{error}</p>}
      </div>

      <div className="camera-actions">
        {(phase === "idle" || phase === "error") && (
          <button className="primary-button" type="button" onClick={() => startCamera()}>Enable camera</button>
        )}
        {phase === "live" && (
          <>
            <button className="primary-button" type="button" onClick={takePhoto}>Take photo</button>
            <button className="secondary-button" type="button" onClick={switchCamera}>
              Use {facingMode === "user" ? "rear" : "front"} camera
            </button>
          </>
        )}
        {phase === "captured" && (
          <>
            <button className="secondary-button" type="button" onClick={retake}>Retake photo</button>
            <button className="text-button" type="button" onClick={() => { discardPhoto(); setPhase("idle"); }}>Clear photo</button>
          </>
        )}
      </div>
      <p className="privacy-note">No audio is requested. The captured JPEG remains in this open browser page and is not uploaded in this build.</p>
    </div>
  );
}

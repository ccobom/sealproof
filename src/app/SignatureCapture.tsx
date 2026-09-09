import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  SIGNATURE_CONTRACT,
  validateSignature,
  type Signature,
  type SignaturePoint,
  type SignatureStroke,
} from "../document/signature-contract";

interface SignatureCaptureProps {
  onSignatureChange: (signature: Signature | undefined) => void;
}

const MINIMUM_POINT_DISTANCE = 0.002;

function normalizedPoint(event: ReactPointerEvent<HTMLCanvasElement>): SignaturePoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
}

function isDistinct(point: SignaturePoint, previous: SignaturePoint): boolean {
  return Math.hypot(point.x - previous.x, point.y - previous.y) >= MINIMUM_POINT_DISTANCE;
}

export function SignatureCapture({ onSignatureChange }: SignatureCaptureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<SignatureStroke>();
  const strokes = useRef<Signature>([]);
  const [signature, setSignature] = useState<Signature>([]);
  const [message, setMessage] = useState("Draw your signature inside the box.");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function draw() {
      const bounds = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.clearRect(0, 0, bounds.width, bounds.height);
      context.strokeStyle = "#17201c";
      context.lineWidth = 2.5;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const stroke of signature) {
        context.beginPath();
        stroke.forEach((point, index) => {
          const x = point.x * bounds.width;
          const y = point.y * bounds.height;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
      }
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [signature]);

  function startStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!event.isPrimary || activeStroke.current) return;
    if (strokes.current.length >= SIGNATURE_CONTRACT.maximumStrokes) {
      setMessage("Stroke limit reached. Clear the signature and try again.");
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke = [normalizedPoint(event)];
    activeStroke.current = stroke;
    strokes.current.push(stroke);
    setSignature([...strokes.current]);
    setMessage("Keep drawing, or clear the box to start again.");
  }

  function continueStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeStroke.current;
    if (!stroke || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    const totalPoints = strokes.current.reduce((total, item) => total + item.length, 0);
    if (
      stroke.length >= SIGNATURE_CONTRACT.maximumPointsPerStroke ||
      totalPoints >= SIGNATURE_CONTRACT.maximumTotalPoints
    ) return;
    const point = normalizedPoint(event);
    if (!isDistinct(point, stroke[stroke.length - 1])) return;
    stroke.push(point);
    setSignature([...strokes.current]);
  }

  function endStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeStroke.current;
    if (!stroke) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeStroke.current = undefined;

    if (stroke.length < 2) strokes.current = strokes.current.filter((item) => item !== stroke);
    const completed = [...strokes.current];
    setSignature(completed);
    try {
      validateSignature(completed);
      onSignatureChange(completed);
      setMessage("Signature captured locally. You may clear and redraw it.");
    } catch {
      onSignatureChange(undefined);
      setMessage("Draw a line in the box; a tap by itself is not enough.");
    }
  }

  function clear() {
    activeStroke.current = undefined;
    strokes.current = [];
    setSignature([]);
    onSignatureChange(undefined);
    setMessage("Signature cleared. Draw your signature inside the box.");
  }

  return (
    <div className="signature-capture">
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        aria-label="Draw your signature"
        role="img"
        tabIndex={0}
        onPointerDown={startStroke}
        onPointerMove={continueStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      <p className="privacy-note" aria-live="polite">{message}</p>
      <button className="secondary-button" type="button" onClick={clear}>Clear signature</button>
    </div>
  );
}

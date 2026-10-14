import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Asset, Drawing } from './types';

type Props = {
  video: RefObject<HTMLVideoElement | null>;
  asset: Asset;
  drawing: boolean;
  strokes: Drawing[];
  color: string;
  onStroke: (stroke: Drawing) => void;
  onLimit: () => void;
};

// Coordinates are relative to the video picture, so portrait and letterboxed
// footage retain the same marks when the player changes size.
export function DrawingOverlay({
  video,
  asset,
  drawing,
  strokes,
  color,
  onStroke,
  onLimit,
}: Props) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [live, setLive] = useState<Drawing | null>(null);
  const strokeRef = useRef<Drawing | null>(null);
  const pointer = useRef<number | null>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const measure = () => {
      const bounds = v.getBoundingClientRect();
      const ratio = (v.videoWidth || asset.width) / (v.videoHeight || asset.height);
      const width = Math.min(bounds.width, bounds.height * ratio);
      const height = width / ratio;
      setBox({
        left: (bounds.width - width) / 2,
        top: (bounds.height - height) / 2,
        width,
        height,
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(v);
    v.addEventListener('loadedmetadata', measure);
    measure();
    return () => {
      observer.disconnect();
      v.removeEventListener('loadedmetadata', measure);
    };
  }, [asset.id, asset.width, asset.height, video]);
  useEffect(() => {
    if (!drawing) {
      strokeRef.current = null;
      pointer.current = null;
      setLive(null);
    }
  }, [drawing]);
  const totalPoints = strokes.reduce((sum, s) => sum + s.points.length, 0);
  const displayed = live ? [...strokes, live] : strokes;
  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000;
    return {
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height),
    };
  };
  function finish(e: React.PointerEvent<SVGSVGElement>, cancelled = false) {
    if (pointer.current !== e.pointerId) return;
    const stroke = strokeRef.current;
    strokeRef.current = null;
    pointer.current = null;
    setLive(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (stroke && !cancelled) onStroke(stroke);
  }
  return (
    <svg
      className={`drawing-overlay ${drawing ? 'is-drawing' : ''}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      viewBox={`0 0 ${box.width || 1} ${box.height || 1}`}
      role="img"
      aria-label={drawing ? 'Draw on this video frame' : 'Drawing on this video frame'}
      onPointerDown={(e) => {
        if (!drawing || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || !box.width)
          return;
        e.preventDefault();
        if (strokes.length >= 40 || totalPoints >= 12000) {
          onLimit();
          return;
        }
        const next = { color, width: 0.004, points: [point(e)] };
        strokeRef.current = next;
        pointer.current = e.pointerId;
        setLive(next);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const stroke = strokeRef.current;
        if (!stroke || pointer.current !== e.pointerId) return;
        const p = point(e);
        const last = stroke.points.at(-1)!;
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.001) return;
        if (stroke.points.length >= 1500 || totalPoints + stroke.points.length >= 12000) return;
        const next = { ...stroke, points: [...stroke.points, p] };
        strokeRef.current = next;
        setLive(next);
      }}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={(e) => finish(e, true)}
      onLostPointerCapture={(e) => finish(e, true)}
    >
      {displayed.map((stroke, i) =>
        stroke.points.length === 1 ? (
          <circle
            key={i}
            cx={stroke.points[0].x * box.width}
            cy={stroke.points[0].y * box.height}
            r={(stroke.width * box.width) / 2}
            fill={stroke.color}
          />
        ) : (
          <polyline
            key={i}
            points={stroke.points.map((p) => `${p.x * box.width},${p.y * box.height}`).join(' ')}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width * box.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}

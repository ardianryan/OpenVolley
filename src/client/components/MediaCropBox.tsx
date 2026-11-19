import { Check, Crop, Move, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  MAX_MEDIA_ZOOM,
  MIN_MEDIA_ZOOM,
  applyPanDelta,
  applyZoomLevel,
  type MediaFraming,
} from '../../shared/media-framing';

interface MediaCropBoxProps {
  title: string;
  imageUrl: string | null;
  aspectRatio: number;
  zoom: number;
  panX: number;
  panY: number;
  cssFilter?: string;
  onChange: (next: MediaFraming) => void;
  onReset: () => void;
  onClose?: () => void;
}

export function MediaCropBox({
  title,
  imageUrl,
  aspectRatio,
  zoom,
  panX,
  panY,
  cssFilter,
  onChange,
  onReset,
  onClose,
}: MediaCropBoxProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [interacting, setInteracting] = useState(false);

  const stateRef = useRef({
    framing: { zoom, panX, panY },
    frameSize,
    naturalSize,
    onChange,
  });
  stateRef.current = {
    framing: { zoom, panX, panY },
    frameSize,
    naturalSize,
    onChange,
  };

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    lastX: number;
    lastY: number;
    pinchDist: number;
    pinchMidX: number;
    pinchMidY: number;
  }>({
    lastX: 0,
    lastY: 0,
    pinchDist: 0,
    pinchMidX: 0,
    pinchMidY: 0,
  });

  useEffect(() => {
    setNaturalSize({ w: 0, h: 0 });
  }, [imageUrl]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setFrameSize({ w: rect.width, h: rect.height });
      }
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [aspectRatio, imageUrl]);

  // Non-passive wheel / trackpad-pinch zoom listener
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !imageUrl) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = stateRef.current;
      const factor = e.ctrlKey ? -e.deltaY * 0.015 : -e.deltaY * 0.0025;
      if (Math.abs(factor) < 0.0001) return;
      const nextZoom = cur.framing.zoom + factor;
      const updated = applyZoomLevel(
        cur.framing,
        nextZoom,
        cur.naturalSize.w,
        cur.naturalSize.h,
        cur.frameSize.w,
        cur.frameSize.h
      );
      cur.onChange(updated);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [imageUrl]);

  const computeTwoPointerMetrics = () => {
    const pts = Array.from(pointersRef.current.values());
    if (pts.length < 2) return null;
    const [p1, p2] = [pts[0]!, pts[1]!];
    const dist = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    return { dist, midX, midY };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imageUrl) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setInteracting(true);

    if (pointersRef.current.size === 2) {
      const m = computeTwoPointerMetrics();
      if (m) {
        gestureRef.current.pinchDist = m.dist;
        gestureRef.current.pinchMidX = m.midX;
        gestureRef.current.pinchMidY = m.midY;
      }
    } else {
      gestureRef.current.lastX = e.clientX;
      gestureRef.current.lastY = e.clientY;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cur = stateRef.current;
    const fw = Math.max(1, cur.frameSize.w);
    const fh = Math.max(1, cur.frameSize.h);

    if (pointersRef.current.size >= 2) {
      const m = computeTwoPointerMetrics();
      if (!m) return;
      const scaleRatio = m.dist / Math.max(1, gestureRef.current.pinchDist);
      const nextZoom = cur.framing.zoom * scaleRatio;
      const zoomed = applyZoomLevel(
        cur.framing,
        nextZoom,
        cur.naturalSize.w,
        cur.naturalSize.h,
        fw,
        fh
      );
      const panned = applyPanDelta(
        zoomed,
        m.midX - gestureRef.current.pinchMidX,
        m.midY - gestureRef.current.pinchMidY,
        fw,
        fh,
        cur.naturalSize.w,
        cur.naturalSize.h,
        fw,
        fh
      );
      gestureRef.current.pinchDist = m.dist;
      gestureRef.current.pinchMidX = m.midX;
      gestureRef.current.pinchMidY = m.midY;
      cur.onChange(panned);
      return;
    }

    const dx = e.clientX - gestureRef.current.lastX;
    const dy = e.clientY - gestureRef.current.lastY;
    gestureRef.current.lastX = e.clientX;
    gestureRef.current.lastY = e.clientY;
    const next = applyPanDelta(
      cur.framing,
      dx,
      dy,
      fw,
      fh,
      cur.naturalSize.w,
      cur.naturalSize.h,
      fw,
      fh
    );
    cur.onChange(next);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.values())[0]!;
      gestureRef.current.lastX = remaining.x;
      gestureRef.current.lastY = remaining.y;
    } else if (pointersRef.current.size === 0) {
      setInteracting(false);
    }
  };

  const stepZoom = (delta: number) => {
    const next = applyZoomLevel(
      { zoom, panX, panY },
      zoom + delta,
      naturalSize.w,
      naturalSize.h,
      frameSize.w,
      frameSize.h
    );
    onChange(next);
  };

  // Compute exact cover draw coordinates matching drawMediaCoverRect
  const hasMeasured =
    naturalSize.w > 0 && naturalSize.h > 0 && frameSize.w > 0 && frameSize.h > 0;
  let imgStyle: React.CSSProperties = {
    filter: cssFilter && cssFilter !== 'none' ? cssFilter : undefined,
  };
  if (hasMeasured) {
    const srcAspect = naturalSize.w / naturalSize.h;
    const rectAspect = frameSize.w / frameSize.h;
    let dw = frameSize.w;
    let dh = frameSize.h;
    if (srcAspect > rectAspect) {
      dh = frameSize.h * zoom;
      dw = dh * srcAspect;
    } else {
      dw = frameSize.w * zoom;
      dh = dw / srcAspect;
    }
    imgStyle = {
      ...imgStyle,
      position: 'absolute',
      width: `${dw}px`,
      height: `${dh}px`,
      left: `${(frameSize.w - dw) / 2 + panX * frameSize.w}px`,
      top: `${(frameSize.h - dh) / 2 + panY * frameSize.h}px`,
      maxWidth: 'none',
      maxHeight: 'none',
    };
  } else {
    imgStyle = {
      ...imgStyle,
      transform: `translate(${panX * 100}%, ${panY * 100}%) scale(${zoom})`,
      transformOrigin: 'center center',
    };
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-amber-500/35 bg-slate-950 p-3 text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-300">
          <Crop className="h-3.5 w-3.5" />
          {title}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-300">
          <Move className="h-3 w-3 text-amber-400" />
          Geser &amp; Pinch / Scroll
        </span>
      </div>

      {/* Interactive Crop Viewport */}
      <div className="flex justify-center">
        <div
          ref={frameRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onDoubleClick={onReset}
          style={{ aspectRatio: String(Math.max(0.4, Math.min(2.5, aspectRatio))) }}
          aria-label="Area crop visual"
          className="group relative max-h-60 w-full max-w-[340px] touch-none select-none overflow-hidden rounded-xl border-2 border-amber-400/80 bg-black cursor-grab active:cursor-grabbing"
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              draggable={false}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth > 0 && im.naturalHeight > 0) {
                  setNaturalSize({ w: im.naturalWidth, h: im.naturalHeight });
                }
              }}
              style={imgStyle}
              className={hasMeasured ? 'pointer-events-none select-none' : 'pointer-events-none h-full w-full object-cover select-none'}
            />
          ) : (
            <div className="flex h-36 items-center justify-center text-xs text-slate-400">
              Menyiapkan pratinjau crop...
            </div>
          )}

          {/* 3x3 Rule-of-Thirds Crop Grid (stronger while dragging, subtle on hover) */}
          <div
            className={`pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 transition-opacity ${
              interacting ? 'opacity-90' : 'opacity-25 group-hover:opacity-65'
            }`}
          >
            {Array.from({ length: 9 }).map((_, idx) => (
              <div key={idx} className="border border-white/35" />
            ))}
          </div>

          {/* Corner Crop Handles (visual IG-style markers) */}
          <span className="pointer-events-none absolute left-1.5 top-1.5 h-3 w-3 border-l-2 border-t-2 border-amber-300" />
          <span className="pointer-events-none absolute right-1.5 top-1.5 h-3 w-3 border-r-2 border-t-2 border-amber-300" />
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-3 w-3 border-b-2 border-l-2 border-amber-300" />
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-3 w-3 border-b-2 border-r-2 border-amber-300" />
        </div>
      </div>

      {/* Compact Zoom / Reset / Done Controls (No Range Sliders) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-900 p-1">
          <button
            type="button"
            disabled={zoom <= MIN_MEDIA_ZOOM}
            onClick={() => stepZoom(-0.2)}
            aria-label="Perkecil zoom"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-200 hover:bg-slate-800 disabled:opacity-35"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-11 text-center font-mono text-[11px] font-bold text-amber-300 tabular-nums">
            {zoom.toFixed(1)}x
          </span>
          <button
            type="button"
            disabled={zoom >= MAX_MEDIA_ZOOM}
            onClick={() => stepZoom(0.2)}
            aria-label="Perbesar zoom"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-200 hover:bg-slate-800 disabled:opacity-35"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-bold text-slate-200 hover:bg-slate-800"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-amber-500 px-2.5 text-[11px] font-extrabold text-slate-950 hover:bg-amber-400"
            >
              <Check className="h-3.5 w-3.5" />
              Selesai
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

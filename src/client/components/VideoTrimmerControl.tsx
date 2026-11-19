import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Play,
  Scissors,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  MAX_VIDEO_CLIP_SEC,
  clampTrimWindow,
  shiftTrimWindow,
} from '../../shared/media-timeline';

export interface VideoClipState {
  url: string;
  fileName: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  coverTime: number;
  volume: number;
  muted: boolean;
  zoom?: number;
  panX?: number;
  panY?: number;
  fileSizeBytes?: number;
}

interface VideoTrimmerControlProps {
  clip: VideoClipState;
  onChange: (next: VideoClipState) => void;
  onCaptureCover: (img: HTMLImageElement, atTime: number) => void;
  onRemove: () => void;
}

type DragMode = 'start' | 'end' | 'window' | 'scrub' | null;

const THUMB_COUNT = 10;

function formatSeconds(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const rem = (safe % 60).toFixed(1).padStart(4, '0');
  return `${String(mins).padStart(2, '0')}:${rem}`;
}

function formatCompactDuration(sec: number): string {
  const rounded = Math.max(0, Math.round(sec));
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatFileMb(bytes?: number): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

export function VideoTrimmerControl({
  clip,
  onChange,
  onCaptureCover,
  onRemove,
}: VideoTrimmerControlProps) {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const clipRef = useRef(clip);
  clipRef.current = clip;

  const [playingTrim, setPlayingTrim] = useState(false);
  const [currentSec, setCurrentSec] = useState(clip.trimStart);
  const [coverSavedPulse, setCoverSavedPulse] = useState(false);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [dragMode, setDragMode] = useState<DragMode>(null);

  const dragOriginRef = useRef<{
    mode: DragMode;
    startX: number;
    origStart: number;
    origEnd: number;
  }>({
    mode: null,
    startX: 0,
    origStart: 0,
    origEnd: 0,
  });

  const captureFrameFromVideo = (v: HTMLVideoElement, atTime: number) => {
    if (v.videoWidth <= 0 || v.videoHeight <= 0) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const img = new Image();
    img.onload = () => {
      onCaptureCover(img, atTime);
    };
    img.src = c.toDataURL('image/jpeg', 0.92);
  };

  // Seek preview video when loaded and capture initial cover frame automatically
  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v) return;

    const handleLoaded = () => {
      const curClip = clipRef.current;
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : curClip.duration;
      const initialEnd = Math.min(dur, Math.min(10, MAX_VIDEO_CLIP_SEC));
      const next =
        curClip.duration !== dur
          ? {
              ...curClip,
              duration: dur,
              trimStart: 0,
              trimEnd: Number(initialEnd.toFixed(1)),
              coverTime: Number((initialEnd * 0.35).toFixed(1)),
            }
          : curClip;
      if (next !== curClip) {
        onChange(next);
      }

      const targetCover = Math.min(dur, Math.max(0, next.coverTime));
      const onInitialSeek = () => {
        captureFrameFromVideo(v, targetCover);
        v.removeEventListener('seeked', onInitialSeek);
      };
      v.addEventListener('seeked', onInitialSeek);
      v.currentTime = targetCover;
    };

    if (v.readyState >= 2) {
      handleLoaded();
    } else {
      v.addEventListener('loadeddata', handleLoaded, { once: true });
    }
  }, [clip.url]);

  // Sequential Filmstrip Frame Extractor (~10 thumbnails, 76x56 scratch canvas)
  useEffect(() => {
    let cancelled = false;
    setThumbnails([]);

    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    vid.src = clip.url;

    const canvas = document.createElement('canvas');
    canvas.width = 76;
    canvas.height = 56;
    const ctx = canvas.getContext('2d');

    const cleanup = () => {
      vid.onloadedmetadata = null;
      vid.onloadeddata = null;
      vid.onseeked = null;
      vid.onerror = null;
      vid.removeAttribute('src');
      vid.load();
    };

    const runExtraction = async () => {
      const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : clipRef.current.duration || 10;
      const minT = Math.min(0.05, dur * 0.05);
      const maxT = Math.max(minT, dur - 0.05);

      for (let i = 0; i < THUMB_COUNT; i++) {
        if (cancelled) break;
        const frac = THUMB_COUNT > 1 ? i / (THUMB_COUNT - 1) : 0;
        const targetTime = minT + (maxT - minT) * frac;

        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            vid.removeEventListener('seeked', onSeek);
            resolve();
          };
          const timer = window.setTimeout(finish, 900);
          const onSeek = () => {
            window.clearTimeout(timer);
            finish();
          };
          vid.addEventListener('seeked', onSeek, { once: true });
          try {
            vid.currentTime = targetTime;
          } catch {
            window.clearTimeout(timer);
            finish();
          }
        });

        if (cancelled) break;
        if (ctx && vid.videoWidth > 0 && vid.videoHeight > 0) {
          // Cover-crop frame neatly into 76x56 cell
          const vw = vid.videoWidth;
          const vh = vid.videoHeight;
          const scale = Math.max(canvas.width / vw, canvas.height / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          ctx.drawImage(
            vid,
            (canvas.width - dw) / 2,
            (canvas.height - dh) / 2,
            dw,
            dh
          );
          const url = canvas.toDataURL('image/jpeg', 0.6);
          if (!cancelled) {
            setThumbnails((prev) => [...prev, url]);
          }
        }
      }
      cleanup();
    };

    const onReady = () => {
      if (cancelled) {
        cleanup();
        return;
      }
      void runExtraction();
    };

    if (vid.readyState >= 2) {
      onReady();
    } else {
      vid.addEventListener('loadeddata', onReady, { once: true });
      vid.addEventListener('error', cleanup, { once: true });
    }

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [clip.url]);

  // Smooth playhead sync & automatic stop at trimEnd
  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v) return;

    let rafId = 0;
    const tick = () => {
      setCurrentSec(v.currentTime);
      if (playingTrim && v.currentTime >= clipRef.current.trimEnd) {
        v.pause();
        v.currentTime = clipRef.current.trimStart;
        setCurrentSec(clipRef.current.trimStart);
        setPlayingTrim(false);
        return;
      }
      if (playingTrim && !v.paused) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const onTimeUpdate = () => {
      setCurrentSec(v.currentTime);
      if (playingTrim && v.currentTime >= clipRef.current.trimEnd) {
        v.pause();
        v.currentTime = clipRef.current.trimStart;
        setPlayingTrim(false);
      }
    };

    v.addEventListener('timeupdate', onTimeUpdate);
    if (playingTrim) {
      rafId = requestAnimationFrame(tick);
    }
    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate);
      cancelAnimationFrame(rafId);
    };
  }, [playingTrim]);

  const seekTo = (sec: number) => {
    const v = previewVideoRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      setPlayingTrim(false);
    }
    const totalDur = Math.max(0.5, clipRef.current.duration || 1);
    const clamped = Math.max(0, Math.min(totalDur, sec));
    v.currentTime = clamped;
    setCurrentSec(clamped);
  };

  const togglePlayTrim = () => {
    const v = previewVideoRef.current;
    if (!v) return;
    if (playingTrim) {
      v.pause();
      setPlayingTrim(false);
      return;
    }
    v.currentTime = clip.trimStart;
    v.muted = clip.muted;
    v.volume = clip.volume;
    v.play()
      .then(() => setPlayingTrim(true))
      .catch(() => setPlayingTrim(false));
  };

  const handleSetCoverNow = () => {
    const v = previewVideoRef.current;
    if (!v) return;
    const t = Number(v.currentTime.toFixed(1));
    captureFrameFromVideo(v, t);
    onChange({ ...clip, coverTime: t });
    setCoverSavedPulse(true);
    window.setTimeout(() => setCoverSavedPulse(false), 1800);
  };

  const totalDur = Math.max(0.5, clip.duration || 10);
  const clipSpan = Math.max(0, Number((clip.trimEnd - clip.trimStart).toFixed(1)));
  const startPct = Math.min(100, Math.max(0, (clip.trimStart / totalDur) * 100));
  const widthPct = Math.min(100 - startPct, Math.max(2, (clipSpan / totalDur) * 100));
  const playheadPct = Math.min(100, Math.max(0, (currentSec / totalDur) * 100));
  const fileMb = formatFileMb(clip.fileSizeBytes);

  const clientXToSec = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    return Number((frac * totalDur).toFixed(1));
  };

  const beginDrag = (e: React.PointerEvent<HTMLElement>, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if synthetic
    }
    dragOriginRef.current = {
      mode,
      startX: e.clientX,
      origStart: clip.trimStart,
      origEnd: clip.trimEnd,
    };
    setDragMode(mode);

    if (mode === 'scrub') {
      seekTo(clientXToSec(e.clientX));
    }
  };

  const handleDragMove = (e: React.PointerEvent<HTMLElement>) => {
    const origin = dragOriginRef.current;
    if (!origin.mode) return;
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const widthPx = Math.max(1, rect.width);

    if (origin.mode === 'start') {
      const timeAtPointer = clientXToSec(e.clientX);
      const { trimStart, trimEnd } = clampTrimWindow(
        totalDur,
        timeAtPointer,
        origin.origEnd,
        'start'
      );
      onChange({ ...clipRef.current, trimStart, trimEnd });
      seekTo(trimStart);
    } else if (origin.mode === 'end') {
      const timeAtPointer = clientXToSec(e.clientX);
      const { trimStart, trimEnd } = clampTrimWindow(
        totalDur,
        origin.origStart,
        timeAtPointer,
        'end'
      );
      onChange({ ...clipRef.current, trimStart, trimEnd });
      seekTo(trimEnd);
    } else if (origin.mode === 'window') {
      const deltaPx = e.clientX - origin.startX;
      const deltaSec = (deltaPx / widthPx) * totalDur;
      const { trimStart, trimEnd } = shiftTrimWindow(
        totalDur,
        origin.origStart,
        origin.origEnd,
        deltaSec
      );
      onChange({ ...clipRef.current, trimStart, trimEnd });
      seekTo(trimStart);
    } else if (origin.mode === 'scrub') {
      seekTo(clientXToSec(e.clientX));
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragOriginRef.current.mode) return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    dragOriginRef.current.mode = null;
    setDragMode(null);
  };

  return (
    <div className="space-y-2.5 rounded-2xl border border-amber-500/35 bg-slate-950 p-3 text-white shadow-sm">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Scissors className="h-4 w-4 shrink-0 text-amber-400" />
          <span className="truncate text-xs font-extrabold uppercase tracking-wider">
            Trim Video ({clipSpan}s / Maks {MAX_VIDEO_CLIP_SEC}s)
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Hapus klip video"
          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-red-500/35 bg-red-500/15 px-2.5 py-1 text-[11px] font-bold text-red-300 hover:bg-red-500/25"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Ganti
        </button>
      </div>

      {/* WhatsApp-Style Top Filmstrip Timeline */}
      <div
        ref={trackRef}
        onPointerDown={(e) => beginDrag(e, 'scrub')}
        onPointerMove={handleDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-14 w-full select-none overflow-hidden rounded-xl border border-slate-700 bg-slate-900 touch-none cursor-pointer"
        aria-label="Timeline pemotong video"
      >
        {/* 10 Filmstrip Thumbnails */}
        <div className="grid h-full w-full grid-cols-10 bg-slate-900">
          {Array.from({ length: THUMB_COUNT }).map((_, i) => {
            const thumb = thumbnails[i];
            return (
              <div
                key={i}
                className="h-full w-full overflow-hidden border-r border-slate-800/60 last:border-r-0"
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover pointer-events-none"
                  />
                ) : (
                  <div className="h-full w-full animate-pulse bg-slate-800/70" />
                )}
              </div>
            );
          })}
        </div>

        {/* Dimmed outside-trim masks */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-slate-950/72"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-slate-950/72"
          style={{ width: `${Math.max(0, 100 - startPct - widthPct)}%` }}
        />

        {/* Interactive White Playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.95)]"
          style={{ left: `calc(${playheadPct}% - 1px)` }}
        />

        {/* Active Amber Selection Window (< [drag] >) */}
        <div
          className="absolute inset-y-0 z-10 flex items-stretch border-y-2 border-amber-400"
          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
        >
          {/* Left Trim Handle (<) */}
          <button
            type="button"
            onPointerDown={(e) => beginDrag(e, 'start')}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label="Geser titik mulai video"
            className={`flex w-5 shrink-0 cursor-ew-resize items-center justify-center rounded-l-md bg-amber-400 text-slate-950 transition ${
              dragMode === 'start' ? 'brightness-110' : 'hover:bg-amber-300'
            }`}
          >
            <ChevronLeft className="h-3.5 w-3.5 stroke-[3]" />
          </button>

          {/* Middle Sliding Window Drag Area */}
          <div
            onPointerDown={(e) => beginDrag(e, 'window')}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            title="Seret untuk menggeser jendela potongan"
            className={`flex-1 cursor-grab active:cursor-grabbing ${
              dragMode === 'window' ? 'bg-amber-400/15' : 'bg-transparent'
            }`}
          />

          {/* Right Trim Handle (>) */}
          <button
            type="button"
            onPointerDown={(e) => beginDrag(e, 'end')}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label="Geser titik selesai video"
            className={`flex w-5 shrink-0 cursor-ew-resize items-center justify-center rounded-r-md bg-amber-400 text-slate-950 transition ${
              dragMode === 'end' ? 'brightness-110' : 'hover:bg-amber-300'
            }`}
          >
            <ChevronRight className="h-3.5 w-3.5 stroke-[3]" />
          </button>
        </div>
      </div>

      {/* Compact WhatsApp-style Status Pills below Filmstrip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...clip, muted: !clip.muted })}
            aria-label={clip.muted ? 'Aktifkan audio asli video' : 'Bisukan audio asli video'}
            className={`inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 py-1 font-bold transition ${
              clip.muted
                ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
            }`}
          >
            {clip.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span>{clip.muted ? 'Bisu' : `${Math.round(clip.volume * 100)}%`}</span>
          </button>

          {!clip.muted && (
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={clip.volume}
              aria-label="Volume suara asli video"
              onChange={(e) => onChange({ ...clip, volume: Number(e.target.value) })}
              className="h-1.5 w-16 cursor-pointer accent-amber-400"
            />
          )}

          <span className="rounded-full bg-slate-800/90 px-2.5 py-1 font-mono font-bold text-slate-200 tabular-nums">
            {formatCompactDuration(clipSpan)}
            {fileMb ? ` • ${fileMb}` : ''}
          </span>
        </div>

        <span className="font-mono text-[11px] font-bold text-amber-300 tabular-nums">
          {formatSeconds(clip.trimStart)} – {formatSeconds(clip.trimEnd)}
        </span>
      </div>

      {/* Interactive Scrubbable Video Monitor */}
      <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-black">
        <video
          ref={previewVideoRef}
          src={clip.url}
          playsInline
          muted={clip.muted}
          preload="auto"
          className="max-h-52 w-full object-contain"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/95 px-3 py-2 text-xs text-white">
          <button
            type="button"
            onClick={togglePlayTrim}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 font-extrabold text-slate-950 transition hover:bg-amber-400"
          >
            {playingTrim ? (
              <>
                <Square className="h-3 w-3 fill-current" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-current" />
                Cek Potongan ({clipSpan}s)
              </>
            )}
          </button>

          <span className="font-mono text-[11px] font-bold text-slate-300 tabular-nums">
            {formatSeconds(currentSec)} / {formatSeconds(totalDur)}
          </span>

          <button
            type="button"
            onClick={handleSetCoverNow}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-100 transition hover:border-amber-400 hover:text-amber-300"
          >
            {coverSavedPulse ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Cover Disimpan
              </>
            ) : (
              <>
                <Camera className="h-3.5 w-3.5 text-amber-400" />
                Jadikan Cover
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

import { Camera, Check, Play, Scissors, Square, Trash2, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_VIDEO_CLIP_SEC, clampTrimWindow } from '../../shared/media-timeline';

export interface VideoClipState {
  url: string;
  fileName: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  coverTime: number;
  volume: number;
  muted: boolean;
}

interface VideoTrimmerControlProps {
  clip: VideoClipState;
  onChange: (next: VideoClipState) => void;
  onCaptureCover: (img: HTMLImageElement, atTime: number) => void;
  onRemove: () => void;
}

function formatSeconds(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const rem = (safe % 60).toFixed(1).padStart(4, '0');
  return `${String(mins).padStart(2, '0')}:${rem}`;
}

export function VideoTrimmerControl({
  clip,
  onChange,
  onCaptureCover,
  onRemove,
}: VideoTrimmerControlProps) {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [playingTrim, setPlayingTrim] = useState(false);
  const [currentSec, setCurrentSec] = useState(clip.trimStart);
  const [coverSavedPulse, setCoverSavedPulse] = useState(false);

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
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : clip.duration;
      const initialEnd = Math.min(dur, Math.min(10, MAX_VIDEO_CLIP_SEC));
      const next =
        clip.duration !== dur
          ? {
              ...clip,
              duration: dur,
              trimStart: 0,
              trimEnd: Number(initialEnd.toFixed(1)),
              coverTime: Number((initialEnd * 0.35).toFixed(1)),
            }
          : clip;
      if (next !== clip) {
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

  // Stop segment preview automatically once reaching trimEnd
  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v) return;
    const onTimeUpdate = () => {
      setCurrentSec(v.currentTime);
      if (playingTrim && v.currentTime >= clip.trimEnd) {
        v.pause();
        v.currentTime = clip.trimStart;
        setPlayingTrim(false);
      }
    };
    v.addEventListener('timeupdate', onTimeUpdate);
    return () => v.removeEventListener('timeupdate', onTimeUpdate);
  }, [playingTrim, clip.trimStart, clip.trimEnd]);

  const seekTo = (sec: number) => {
    const v = previewVideoRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      setPlayingTrim(false);
    }
    const clamped = Math.max(0, Math.min(clip.duration || 1, sec));
    v.currentTime = clamped;
    setCurrentSec(clamped);
  };

  const handleTrimChange = (rawVal: number, side: 'start' | 'end') => {
    const { trimStart, trimEnd } = clampTrimWindow(
      clip.duration,
      side === 'start' ? rawVal : clip.trimStart,
      side === 'end' ? rawVal : clip.trimEnd,
      side
    );
    onChange({ ...clip, trimStart, trimEnd });
    seekTo(side === 'start' ? trimStart : trimEnd);
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

  const clipSpan = Math.max(0, Number((clip.trimEnd - clip.trimStart).toFixed(1)));
  const totalDur = Math.max(0.5, clip.duration || 10);
  const startPct = Math.min(100, Math.max(0, (clip.trimStart / totalDur) * 100));
  const widthPct = Math.min(100 - startPct, Math.max(2, (clipSpan / totalDur) * 100));

  return (
    <div className="space-y-3.5 rounded-2xl border border-amber-500/35 bg-slate-50 p-3.5 dark:bg-slate-950/80">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Scissors className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <span className="truncate text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
            Potong Klip Video ({clipSpan}s / Maks {MAX_VIDEO_CLIP_SEC}s)
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Hapus klip video"
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-500/20 dark:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Ganti
        </button>
      </div>

      {/* Interactive Scrubbable Video Monitor */}
      <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
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
                Stop Potongan
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-current" />
                Cek Potongan ({clipSpan}s)
              </>
            )}
          </button>

          <span className="font-mono text-[11px] font-bold text-amber-300 tabular-nums">
            {formatSeconds(currentSec)} / {formatSeconds(clip.duration)}
          </span>

          <button
            type="button"
            onClick={handleSetCoverNow}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-100 transition hover:border-amber-400 hover:text-amber-300"
          >
            {coverSavedPulse ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Cover Tersimpan
              </>
            ) : (
              <>
                <Camera className="h-3.5 w-3.5 text-amber-400" />
                Jadikan Cover Poster
              </>
            )}
          </button>
        </div>
      </div>

      {/* Visual Highlight Range Bar */}
      <div className="space-y-2.5">
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className="absolute inset-y-0 rounded-full bg-amber-500/85"
            style={{ left: `${startPct}%`, width: `${widthPct}%` }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs">
            <div className="flex items-center justify-between font-bold text-slate-700 dark:text-slate-300">
              <span>Titik Mulai (In)</span>
              <span className="font-mono text-amber-800 tabular-nums dark:text-amber-300">
                {formatSeconds(clip.trimStart)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0.5, Number((totalDur - 0.5).toFixed(1)))}
              step={0.1}
              value={clip.trimStart}
              onChange={(e) => handleTrimChange(Number(e.target.value), 'start')}
              className="h-2 w-full cursor-pointer accent-amber-500"
            />
          </label>

          <label className="block space-y-1 text-xs">
            <div className="flex items-center justify-between font-bold text-slate-700 dark:text-slate-300">
              <span>Titik Selesai (Out)</span>
              <span className="font-mono text-amber-800 tabular-nums dark:text-amber-300">
                {formatSeconds(clip.trimEnd)}
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={Number(totalDur.toFixed(1))}
              step={0.1}
              value={clip.trimEnd}
              onChange={(e) => handleTrimChange(Number(e.target.value), 'end')}
              className="h-2 w-full cursor-pointer accent-amber-500"
            />
          </label>
        </div>
      </div>

      {/* Original Court Audio Mix & Auto-Ducking Control */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...clip, muted: !clip.muted })}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold transition ${
              clip.muted
                ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                : 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
            }`}
          >
            {clip.muted ? (
              <>
                <VolumeX className="h-3.5 w-3.5" />
                Suara Asli: Bisu
              </>
            ) : (
              <>
                <Volume2 className="h-3.5 w-3.5" />
                Suara Asli: Aktif ({Math.round(clip.volume * 100)}%)
              </>
            )}
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
              className="h-1.5 w-24 cursor-pointer accent-amber-500"
            />
          )}
        </div>

        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
          {clip.muted
            ? 'Musik latar BGM diputar penuh 100%'
            : 'Musik BGM otomatis mengecil halus saat klip tayang'}
        </span>
      </div>
    </div>
  );
}

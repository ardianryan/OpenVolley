import {
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Layers,
  Maximize2,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseReportMedia } from '../../shared/gallery-media';
import type { MatchReport } from '../types';

interface GalleryMediaCardProps {
  report: MatchReport;
  compact?: boolean;
  onDelete?: (reportId: number) => void;
  deleting?: boolean;
}

export function GalleryMediaCard({
  report,
  compact = false,
  onDelete,
  deleting = false,
}: GalleryMediaCardProps) {
  const mediaItems = useMemo(
    () => parseReportMedia(report.imagePath, report.mediaJson),
    [report.imagePath, report.mediaJson]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const safeIndex = Math.min(activeIndex, Math.max(0, mediaItems.length - 1));
  const activeItem = mediaItems[safeIndex] ?? {
    type: 'image' as const,
    url: report.imagePath,
  };
  const totalSlides = mediaItems.length;
  const hasMultiple = totalSlides > 1;
  const hasVideo = mediaItems.some((m) => m.type === 'video');

  const snap = useMemo(() => {
    try {
      return JSON.parse(report.scoreSnapshot) as {
        teamA?: string;
        teamB?: string;
        scoreText?: string;
      };
    } catch {
      return {};
    }
  }, [report.scoreSnapshot]);

  const goToSlide = useCallback(
    (nextIdx: number) => {
      if (totalSlides <= 1) return;
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
      const wrapped = ((nextIdx % totalSlides) + totalSlides) % totalSlides;
      setActiveIndex(wrapped);
    },
    [totalSlides]
  );

  useEffect(() => {
    if (!lightboxOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLightboxOpen(false);
      } else if (e.key === 'ArrowLeft') {
        goToSlide(safeIndex - 1);
      } else if (e.key === 'ArrowRight') {
        goToSlide(safeIndex + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [lightboxOpen, goToSlide, safeIndex]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!hasMultiple || !touchStartRef.current) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    if (Math.abs(dx) >= 38 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      if (dx < 0) goToSlide(safeIndex + 1);
      else goToSlide(safeIndex - 1);
    }
  };

  const handleDownloadActive = async () => {
    const ext =
      activeItem.type === 'video'
        ? activeItem.url.endsWith('.webm')
          ? 'webm'
          : activeItem.url.endsWith('.mov')
            ? 'mov'
            : 'mp4'
        : activeItem.url.endsWith('.jpg') || activeItem.url.endsWith('.jpeg')
          ? 'jpg'
          : activeItem.url.endsWith('.webp')
            ? 'webp'
            : 'png';

    const filename = `SVC-AVERSA-${report.id}-${safeIndex + 1}.${ext}`;
    try {
      const res = await fetch(activeItem.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(activeItem.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <>
      <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-amber-500/40 dark:border-slate-800 dark:bg-slate-900">
        {/* Media Stage (Slide Carousel / Video Player) */}
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="relative aspect-[4/3] w-full overflow-hidden bg-slate-950 select-none"
        >
          {activeItem.type === 'video' ? (
            <video
              ref={videoRef}
              key={activeItem.url}
              src={activeItem.url}
              poster={activeItem.posterUrl || report.imagePath}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full bg-slate-950 object-contain"
            />
          ) : (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`Perbesar ${activeItem.label || report.caption || 'Foto Momen'}`}
              className="block h-full w-full cursor-zoom-in focus:outline-none"
            >
              <img
                src={activeItem.url}
                alt={activeItem.label || report.caption || 'Live Report SVC'}
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.015]"
              />
            </button>
          )}

          {/* Top-Right Media Type / Slide Counter Pill */}
          <div className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1.5">
            {activeItem.type === 'video' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/85 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-amber-400 ring-1 ring-amber-400/35 backdrop-blur-sm">
                <Film className="h-3 w-3" />
                Video{hasMultiple ? ` • ${safeIndex + 1}/${totalSlides}` : ''}
              </span>
            ) : hasMultiple ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/85 px-2.5 py-1 text-[11px] font-extrabold tabular-nums text-white ring-1 ring-white/15 backdrop-blur-sm">
                <Layers className="h-3 w-3 text-amber-400" />
                {safeIndex + 1} / {totalSlides}
              </span>
            ) : null}

            {activeItem.type === 'image' && (
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                aria-label="Lihat ukuran penuh"
                title="Lihat Ukuran Penuh"
                className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/80 text-slate-200 ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-amber-500 hover:text-slate-950"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Left / Right Carousel Controls */}
          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goToSlide(safeIndex - 1);
                }}
                aria-label="Slide sebelumnya"
                className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/75 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-amber-500 hover:text-slate-950 sm:h-8 sm:w-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goToSlide(safeIndex + 1);
                }}
                aria-label="Slide berikutnya"
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950/75 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-amber-500 hover:text-slate-950 sm:h-8 sm:w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}

          {/* Score Snapshot Pill + Slide Dots (hidden over native video controls when active item is video) */}
          {activeItem.type !== 'video' && snap.scoreText && (
            <div className="pointer-events-none absolute bottom-2.5 left-2.5 max-w-[78%] truncate rounded-lg bg-slate-950/85 px-2.5 py-1 text-xs font-bold text-amber-400 ring-1 ring-amber-400/25 backdrop-blur-sm">
              {snap.teamA} vs {snap.teamB} • {snap.scoreText}
            </div>
          )}

          {hasMultiple && activeItem.type !== 'video' && (
            <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1 rounded-full bg-slate-950/75 px-2 py-1 backdrop-blur-sm">
              {mediaItems.map((item, idx) => (
                <button
                  key={`${item.url}-${idx}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToSlide(idx);
                  }}
                  aria-label={`Buka slide ${idx + 1}`}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === safeIndex
                      ? 'w-4 bg-amber-400'
                      : 'w-1.5 bg-white/50 hover:bg-white/80'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Quick Slide Switcher Strip when Video + Poster/Photos are bundled */}
        {hasMultiple && hasVideo && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 bg-slate-50/90 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950/60">
            {mediaItems.map((item, idx) => {
              const selected = idx === safeIndex;
              return (
                <button
                  key={`${item.url}-tab-${idx}`}
                  type="button"
                  onClick={() => goToSlide(idx)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                    selected
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'
                  }`}
                >
                  {item.type === 'video' ? (
                    <Film className="h-3 w-3" />
                  ) : (
                    <Layers className="h-3 w-3" />
                  )}
                  <span>
                    {item.label || (item.type === 'video' ? 'Video' : `Slide ${idx + 1}`)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Metadata & Actions Footer */}
        <div
          className={`flex items-start justify-between gap-3 ${
            compact ? 'px-3 py-2.5' : 'p-4'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p
              className={`truncate font-semibold text-slate-900 dark:text-slate-100 ${
                compact ? 'text-xs' : 'text-sm'
              }`}
            >
              {report.caption || 'Momen Pertandingan'}
            </p>
            {!compact ? (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Oleh {report.uploadedBy} •{' '}
                {new Date(report.createdAt).toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {snap.scoreText && activeItem.type === 'video'
                  ? ` • ${snap.teamA} vs ${snap.teamB} (${snap.scoreText})`
                  : ''}
              </p>
            ) : (
              snap.scoreText && (
                <p className="mt-0.5 truncate text-[11px] font-medium text-amber-800 dark:text-amber-400">
                  {snap.teamA} vs {snap.teamB} • {snap.scoreText}
                </p>
              )
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={handleDownloadActive}
              aria-label={`Unduh ${activeItem.type === 'video' ? 'video' : 'foto'} ${
                report.caption || 'Momen Pertandingan'
              }`}
              title={
                activeItem.type === 'video'
                  ? 'Unduh Video'
                  : hasMultiple
                    ? `Unduh Slide ${safeIndex + 1}`
                    : 'Unduh Foto'
              }
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-800 transition hover:border-amber-600 hover:text-amber-800 sm:min-h-9 sm:min-w-9 dark:border-slate-700 dark:text-slate-300 dark:hover:border-amber-400 dark:hover:text-amber-300"
            >
              <Download className="h-4 w-4" />
            </button>

            {onDelete && (
              <button
                type="button"
                disabled={deleting}
                onClick={() => onDelete(report.id)}
                aria-label="Hapus unggahan dari galeri"
                title="Hapus dari Galeri"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-500/10 disabled:opacity-50 sm:min-h-9 sm:min-w-9 dark:border-red-900/60 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </article>

      {/* Fullscreen Uncropped Lightbox Modal (supports 9:16, 4:5, 16:9, 1:1 & Videos) */}
      {lightboxOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Pratinjau Penuh Galeri Momen"
            onClick={() => setLightboxOpen(false)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="animate-backdrop-in fixed inset-0 z-[70] flex flex-col items-center justify-between bg-slate-950/92 p-4 backdrop-blur-md"
          >
            {/* Top Bar */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex w-full max-w-5xl items-center justify-between gap-3 text-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">
                  {report.caption || 'Momen Pertandingan'}
                </p>
                <p className="text-xs text-slate-300">
                  {activeItem.label || `Slide ${safeIndex + 1}`}
                  {hasMultiple ? ` (${safeIndex + 1}/${totalSlides})` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadActive}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 transition hover:bg-amber-400"
                >
                  <Download className="h-4 w-4" />
                  Unduh
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxOpen(false)}
                  aria-label="Tutup pratinjau"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-slate-200 transition hover:bg-slate-700 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Center Media Viewport */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative my-2 flex flex-1 w-full max-w-5xl items-center justify-center overflow-hidden"
            >
              {activeItem.type === 'video' ? (
                <video
                  src={activeItem.url}
                  poster={activeItem.posterUrl || report.imagePath}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[78vh] max-w-full rounded-xl bg-black object-contain shadow-2xl"
                />
              ) : (
                <img
                  src={activeItem.url}
                  alt={activeItem.label || report.caption || 'Momen Pertandingan'}
                  className="max-h-[78vh] max-w-full rounded-xl object-contain shadow-2xl"
                />
              )}

              {hasMultiple && (
                <>
                  <button
                    type="button"
                    onClick={() => goToSlide(safeIndex - 1)}
                    aria-label="Slide sebelumnya"
                    className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/85 text-white ring-1 ring-white/20 transition hover:bg-amber-500 hover:text-slate-950"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goToSlide(safeIndex + 1)}
                    aria-label="Slide berikutnya"
                    className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/85 text-white ring-1 ring-white/20 transition hover:bg-amber-500 hover:text-slate-950"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            {/* Bottom Thumbnails / Dots */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center gap-2 pb-1"
            >
              {hasMultiple &&
                mediaItems.map((item, idx) => (
                  <button
                    key={`lb-dot-${idx}`}
                    type="button"
                    onClick={() => goToSlide(idx)}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                      idx === safeIndex
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {item.type === 'video' ? 'Video' : `Slide ${idx + 1}`}
                  </button>
                ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Crop,
  Crown,
  Download,
  Film,
  HelpCircle,
  ImagePlus,
  LayoutGrid,
  Medal,
  Move,
  Music,
  Palette,
  Play,
  RotateCcw,
  Send,
  Shuffle,
  Square,
  Trash2,
  Trophy,
  Video,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AUDIO_TRACKS,
  getTracksForTemplate,
  pickSmartRandomTrack,
} from '../../shared/audio-library';
import {
  applyPanDelta,
  applyZoomLevel,
  computeMaxPanFractions,
  getCollageSlotRects,
  hitTestCollageSlot,
  type MediaFraming,
} from '../../shared/media-framing';
import { groupMatchesByScheduleDay } from '../../shared/schedule';
import {
  STAGE_VISUAL_META,
  detectMatchStageKey,
  formatInternationalStageLabel,
  type StagePresetKey,
} from '../../shared/stages';
import { resolveTournamentPodium } from '../../shared/podium';
import {
  DEFAULT_VIDEO_CLIP_SEC,
  MAX_STUDIO_PHOTOS,
  MAX_VIDEO_CLIP_SEC,
  computeMediaTimeline,
  computePhotoSlideState,
  type StudioMediaMode,
} from '../../shared/media-timeline';
import { splitTeamRegionName } from '../../shared/team-format';
import { GalleryMediaCard } from '../components/GalleryMediaCard';
import { MediaCropBox } from '../components/MediaCropBox';
import {
  VideoTrimmerControl,
  type VideoClipState,
} from '../components/VideoTrimmerControl';
import { ShinyText } from '../components/reactbits/ShinyText';
import { apiFetch } from '../lib/api';
import { toCorsSafeAssetUrl } from '../lib/assetUrl';
import { scheduleBroadcastSfx } from '../lib/audioSfx';
import {
  IMAGE_INPUT_ACCEPT,
  VIDEO_INPUT_ACCEPT,
  normalizeImageInBrowser,
  prepareVideoInBrowser,
  transcodeToSocialMp4,
} from '../lib/mediaConverter';
import {
  createOffscreenVolleyball3D,
  type OffscreenVolleyballController,
} from '../lib/volleyball3d';
import type { Match, OverviewData, SponsorItem, Team } from '../types';

interface MediaStudioProps {
  data: OverviewData;
  onRefresh: () => Promise<void>;
}

type AspectRatio = '9:16' | '4:5' | '16:9' | '1:1';
type TemplateStyle =
  | 'live'
  | 'final'
  | 'upcoming'
  | 'highlight'
  | 'champion'
  | 'schedule_day'
  | 'bracket'
  | 'clean_frame'
  | 'event_moment'
  | 'venue_rules'
  | 'announcement';

type BracketFocusMode = 'auto_tour' | 'left' | 'right' | 'finals' | 'full';

const NON_MATCH_TEMPLATES: TemplateStyle[] = [
  'clean_frame',
  'event_moment',
  'venue_rules',
  'announcement',
];

function isNonMatchTemplate(tpl: TemplateStyle): boolean {
  return NON_MATCH_TEMPLATES.includes(tpl);
}

function toAudioTarget(
  tpl: TemplateStyle
): 'live' | 'final' | 'upcoming' | 'highlight' | 'champion' | 'schedule_day' {
  if (
    tpl === 'clean_frame' ||
    tpl === 'event_moment' ||
    tpl === 'venue_rules' ||
    tpl === 'announcement'
  ) {
    return 'schedule_day';
  }
  if (tpl === 'bracket') return 'champion';
  return tpl;
}
type ColorFilterPreset = 'original' | 'crisp' | 'warm' | 'bw';
type StageSelection = 'auto' | StagePresetKey;
type PodiumVariant = 'champion_1' | 'runner_up' | 'third_place' | 'podium_all';
type StudioStep = 1 | 2 | 3;

const COLOR_FILTER_MAP: Record<ColorFilterPreset, { label: string; css: string }> = {
  original: { label: 'Original', css: 'none' },
  crisp: { label: 'Sport Crisp', css: 'contrast(1.14) saturate(1.18) brightness(1.03)' },
  warm: { label: 'Arena Warm', css: 'contrast(1.06) saturate(1.14) sepia(0.14) brightness(1.04)' },
  bw: { label: 'Dramatic B&W', css: 'grayscale(1) contrast(1.22) brightness(1.04)' },
};

function InfoTooltip({
  text,
  align = 'center',
}: {
  text: string;
  align?: 'center' | 'right';
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        aria-label={text}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-amber-500/15 hover:text-amber-600 dark:hover:text-amber-300"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute bottom-full z-40 mb-1.5 w-56 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] font-medium normal-case leading-snug tracking-normal text-slate-100 shadow-xl ${
            align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
          }`}
        >
          {text}
        </span>
      )}
    </span>
  );
}

const DIMENSIONS: Record<AspectRatio, { w: number; h: number; label: string }> = {
  '9:16': { w: 1080, h: 1920, label: '9:16 Portrait (Story / Reels)' },
  '4:5': { w: 1080, h: 1350, label: '4:5 Instagram Post' },
  '16:9': { w: 1920, h: 1080, label: '16:9 Landscape (Wide)' },
  '1:1': { w: 1080, h: 1080, label: '1:1 Square Feed' },
};

function easeOutBack(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Fluid broadcast shutter/wipe curve: starts moving immediately with zero dead-zone lag
 * and cushions smoothly into rest (prevents the "stuck for 300ms" feeling of cubic easeIn).
 */
function easeFluidCurtain(v: number): number {
  const t = clamp01(v);
  return 1 - Math.pow(1 - Math.pow(t, 1.25), 3.4);
}

function smoothRange(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  const safeSrc = toCorsSafeAssetUrl(src);
  if (!safeSrc) return Promise.resolve(null);

  return new Promise((resolve) => {
    const img = new Image();
    // Always enforce anonymous CORS / same-origin proxy so HTMLCanvasElement stays 100% origin-clean
    // for captureStream(), toDataURL(), and toBlob(). Pre-decode async and verify on a 1x1 scratch canvas!
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const finalize = () => {
        try {
          const probe = document.createElement('canvas');
          probe.width = 1;
          probe.height = 1;
          const pCtx = probe.getContext('2d');
          if (pCtx) {
            pCtx.drawImage(img, 0, 0, 1, 1);
            pCtx.getImageData(0, 0, 1, 1);
          }
          resolve(img);
        } catch {
          resolve(null);
        }
      };
      if (typeof img.decode === 'function') {
        img.decode().then(finalize).catch(finalize);
      } else {
        finalize();
      }
    };
    img.onerror = () => resolve(null);
    img.src = safeSrc;
  });
}

function drawContainedCanvasImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  maxW: number,
  maxH: number
) {
  const natW = img.naturalWidth || maxW;
  const natH = img.naturalHeight || maxH;
  const scale = Math.min(maxW / Math.max(1, natW), maxH / Math.max(1, natH));
  const dw = natW * scale;
  const dh = natH * scale;
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
}

/**
 * Pure geometric championship crown / medal vector badge for Grand Final & Champion templates
 */
function drawVectorCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fillHex: string
) {
  const hw = size * 0.52;
  const hh = size * 0.38;
  ctx.save();
  ctx.fillStyle = fillHex;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.82, cy + hh);
  ctx.lineTo(cx - hw, cy - hh * 0.45);
  ctx.lineTo(cx - hw * 0.42, cy + hh * 0.12);
  ctx.lineTo(cx, cy - hh);
  ctx.lineTo(cx + hw * 0.42, cy + hh * 0.12);
  ctx.lineTo(cx + hw, cy - hh * 0.45);
  ctx.lineTo(cx + hw * 0.82, cy + hh);
  ctx.closePath();
  ctx.fill();

  // Crown base band
  drawRoundedRect(ctx, cx - hw * 0.82, cy + hh + size * 0.06, hw * 1.64, size * 0.14, 3);
  ctx.fill();
  ctx.restore();
}

/**
 * ReactBits-inspired ShinyText renderer for 2D Canvas video export
 */
function fillShinyText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  sweepPhase: number,
  baseColor: string,
  shineColor: string
) {
  const tw = Math.max(140, ctx.measureText(text).width);
  const grad = ctx.createLinearGradient(x - tw * 0.68, y - 24, x + tw * 0.68, y + 24);
  const center = clamp01(((sweepPhase % 1) + 1) % 1);
  const s0 = Math.max(0, center - 0.18);
  const s1 = center;
  const s2 = Math.min(1, center + 0.18);
  grad.addColorStop(0, baseColor);
  if (s0 > 0) grad.addColorStop(s0, baseColor);
  grad.addColorStop(s1, shineColor);
  if (s2 < 1) grad.addColorStop(s2, baseColor);
  grad.addColorStop(1, baseColor);
  ctx.fillStyle = grad;
  ctx.fillText(text, x, y);
}

/**
 * ReactBits-inspired SplitText word-by-word staggered spring reveal for 2D Canvas
 */
function drawSplitWords(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  baselineY: number,
  progress: number,
  opts: {
    liftPx?: number;
    stagger?: number;
    baseColor: string;
    shineColor?: string;
    shinePhase?: number;
  }
) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return;

  const liftPx = opts.liftPx ?? 34;
  const stagger = opts.stagger ?? 0.14;
  const spaceW = ctx.measureText(' ').width;
  const wordWidths = words.map((w) => ctx.measureText(w).width);
  const totalW =
    wordWidths.reduce((acc, v) => acc + v, 0) + spaceW * Math.max(0, words.length - 1);

  let cursorX = centerX - totalW / 2;
  const prevAlign = ctx.textAlign;
  const prevAlpha = ctx.globalAlpha;
  ctx.textAlign = 'center';

  const span = Math.max(0.28, 1 - Math.max(0, words.length - 1) * stagger);
  words.forEach((word, idx) => {
    const ww = wordWidths[idx];
    const wordCenterX = cursorX + ww / 2;
    const localP = clamp01((progress - idx * stagger) / span);
    if (localP > 0.001) {
      const yOffset = (1 - easeOutBack(localP)) * liftPx;
      ctx.save();
      ctx.globalAlpha = prevAlpha * easeOutCubic(localP);
      if (opts.shineColor !== undefined && opts.shinePhase !== undefined) {
        fillShinyText(
          ctx,
          word,
          wordCenterX,
          baselineY + yOffset,
          opts.shinePhase - idx * 0.08,
          opts.baseColor,
          opts.shineColor
        );
      } else {
        ctx.fillStyle = opts.baseColor;
        ctx.fillText(word, wordCenterX, baselineY + yOffset);
      }
      ctx.restore();
    }
    cursorX += ww + spaceW;
  });

  ctx.textAlign = prevAlign;
}

/**
 * Wraps text up to maxLines (default 2) and auto-fits font size between baseSize and minSize
 * so long team names or event titles stay large and legible on iPhone screens without clipping.
 */
function fitSingleLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  baseSize: number,
  minSize: number,
  fontTemplate: string
): { text: string; fontSize: number } {
  const clean = text.trim();
  if (!clean) return { text: '', fontSize: baseSize };

  for (let size = baseSize; size >= minSize; size -= 1) {
    ctx.font = fontTemplate.replace('{SIZE}', String(size));
    if (ctx.measureText(clean).width <= maxWidth) {
      return { text: clean, fontSize: size };
    }
  }

  ctx.font = fontTemplate.replace('{SIZE}', String(minSize));
  let trimmed = clean;
  while (trimmed.length > 4 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return { text: `${trimmed}…`, fontSize: minSize };
}

function wrapAndFitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  baseSize: number,
  minSize: number,
  fontTemplate: string,
  maxLines = 2
): { lines: string[]; fontSize: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [''], fontSize: baseSize };

  for (let size = baseSize; size >= minSize; size -= 2) {
    ctx.font = fontTemplate.replace('{SIZE}', String(size));

    if (ctx.measureText(words.join(' ')).width <= maxWidth) {
      return { lines: [words.join(' ')], fontSize: size };
    }

    if (maxLines >= 2 && words.length > 1) {
      const lines: string[] = [];
      let current = words[0];
      let overflowed = false;
      for (let i = 1; i < words.length; i++) {
        const candidate = `${current} ${words[i]}`;
        if (ctx.measureText(candidate).width <= maxWidth) {
          current = candidate;
        } else {
          lines.push(current);
          current = words[i];
        }
      }
      lines.push(current);

      if (lines.length <= maxLines) {
        for (const l of lines) {
          if (ctx.measureText(l).width > maxWidth) {
            overflowed = true;
            break;
          }
        }
        if (!overflowed) {
          return { lines, fontSize: size };
        }
      }
    }
  }

  const fallback = fitSingleLine(ctx, words.join(' '), maxWidth, minSize, Math.max(14, minSize - 6), fontTemplate);
  return { lines: [fallback.text], fontSize: fallback.fontSize };
}

function measureWrappedBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  baseSize: number,
  minSize: number,
  fontTemplate: string,
  maxLines = 2,
  lineHeightRatio = 1.08
): { lines: string[]; fontSize: number; lineH: number; totalH: number } {
  const { lines, fontSize } = wrapAndFitLines(
    ctx,
    text,
    maxWidth,
    baseSize,
    minSize,
    fontTemplate,
    maxLines
  );
  const lineH = Math.round(fontSize * lineHeightRatio);
  const totalH = Math.round(fontSize * 0.86) + Math.max(0, lines.length - 1) * lineH + Math.round(fontSize * 0.2);
  return { lines, fontSize, lineH, totalH };
}

/**
 * Draws a 1-2 line SplitText block anchored strictly by its TOP visual edge (`topY`)
 * and returns its exact `bottomY` so subsequent elements never collide with Line 2.
 */
function drawWrappedBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  topY: number,
  maxWidth: number,
  baseSize: number,
  minSize: number,
  fontTemplate: string,
  progress: number,
  opts: {
    liftPx?: number;
    stagger?: number;
    baseColor: string;
    shineColor?: string;
    shinePhase?: number;
    lineHeightRatio?: number;
    maxLines?: number;
  }
): { bottomY: number; fontSize: number } {
  const { lines, fontSize, lineH } = measureWrappedBlock(
    ctx,
    text,
    maxWidth,
    baseSize,
    minSize,
    fontTemplate,
    opts.maxLines ?? 2,
    opts.lineHeightRatio ?? 1.08
  );
  ctx.font = fontTemplate.replace('{SIZE}', String(fontSize));
  const firstBaseline = topY + Math.round(fontSize * 0.84);

  lines.forEach((line, idx) => {
    const lineP = clamp01((progress - idx * 0.14) / (1 - idx * 0.14));
    drawSplitWords(ctx, line, centerX, firstBaseline + idx * lineH, lineP, {
      ...opts,
      shinePhase:
        opts.shinePhase !== undefined ? opts.shinePhase - idx * 0.1 : undefined,
    });
  });

  const lastBaseline = firstBaseline + Math.max(0, lines.length - 1) * lineH;
  return { bottomY: lastBaseline + Math.round(fontSize * 0.22), fontSize };
}

/**
 * ReactBits-inspired CircularText orbiting emblem ring for 2D Canvas
 */
function drawCircularText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  rotationRad: number,
  fontSize: number,
  color: string
) {
  if (radius <= 4 || !text) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotationRad);
  ctx.font = `800 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const chars = Array.from(text);
  const stepAngle = (Math.PI * 2) / chars.length;
  for (let i = 0; i < chars.length; i++) {
    ctx.save();
    ctx.rotate(i * stepAngle);
    ctx.translate(0, -radius);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * ReactBits-inspired Aurora & Parallax Stadium Bokeh Particles
 */
function drawAuroraAndBokeh(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeSec: number,
  alpha: number,
  theme: 'dark' | 'gold'
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  if (theme === 'dark') {
    const blobs = [
      {
        x: w * (0.28 + 0.14 * Math.sin(timeSec * 0.7)),
        y: h * (0.26 + 0.08 * Math.cos(timeSec * 0.55)),
        r: w * 0.58,
        col: 'rgba(245, 197, 56, 0.16)',
      },
      {
        x: w * (0.74 + 0.12 * Math.cos(timeSec * 0.62)),
        y: h * (0.68 + 0.09 * Math.sin(timeSec * 0.5)),
        r: w * 0.54,
        col: 'rgba(56, 189, 248, 0.12)',
      },
    ];
    for (const b of blobs) {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, b.col);
      g.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Deterministic 2-layer parallax bokeh particles
  for (let i = 0; i < 20; i++) {
    const depth = i % 2 === 0 ? 1 : 0.55;
    const seedX = ((i * 137.5) % 100) / 100;
    const seedY = ((i * 293.7) % 100) / 100;
    const px =
      ((seedX * w + Math.sin(timeSec * 0.6 + i) * 32 * depth) % w + w) % w;
    const py =
      ((seedY * h - timeSec * (28 * depth) + h * 4) % h + h) % h;
    const radius = (i % 3 === 0 ? 4.5 : 2.6) * (w / 1080) * depth;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle =
      theme === 'gold'
        ? 'rgba(255, 255, 255, 0.55)'
        : 'rgba(245, 197, 56, 0.42)';
    ctx.fill();
  }
  ctx.restore();
}

/**
 * ReactBits-inspired `LightRays` Volumetric God-Rays Shader for 2D Canvas.
 * Casts additive (`screen`) top-center stadium spotlight beams downward with organic
 * multi-frequency wave undulation, overhead source bloom, and rising golden motes.
 */
function drawReactBitsLightRays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeSec: number,
  opts?: {
    intensity?: number;
    palette?: 'gold' | 'silver' | 'bronze';
    rayLengthRatio?: number;
    spreadRad?: number;
  }
) {
  const intensity = clamp01(opts?.intensity ?? 1);
  if (intensity <= 0.01) return;

  const rgb =
    opts?.palette === 'silver'
      ? ([226, 232, 240] as const)
      : opts?.palette === 'bronze'
        ? ([253, 186, 116] as const)
        : ([253, 224, 71] as const);

  const coreRgb =
    opts?.palette === 'silver'
      ? ([255, 255, 255] as const)
      : opts?.palette === 'bronze'
        ? ([254, 215, 170] as const)
        : ([255, 251, 235] as const);

  const originX = w * 0.5 + Math.sin(timeSec * 0.42) * (w * 0.035);
  const originY = -h * 0.14;
  const maxLen = Math.hypot(w * 0.65, h) * (opts?.rayLengthRatio ?? 1.02);
  const spread = opts?.spreadRad ?? 0.58;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  // 1. Soft Top-Center Volumetric Ceiling Source Halo
  const haloR = Math.max(w, h) * 0.62;
  const haloGrad = ctx.createRadialGradient(
    originX,
    h * 0.02,
    0,
    originX,
    h * 0.02,
    haloR
  );
  haloGrad.addColorStop(0, `rgba(${coreRgb[0]}, ${coreRgb[1]}, ${coreRgb[2]}, ${(0.34 * intensity).toFixed(3)})`);
  haloGrad.addColorStop(0.28, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(0.16 * intensity).toFixed(3)})`);
  haloGrad.addColorStop(0.68, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(0.04 * intensity).toFixed(3)})`);
  haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = haloGrad;
  ctx.fillRect(0, 0, w, h);

  // 2. 15 Multi-Harmonic Volumetric God-Ray Cones (Wide Soft Feather + Warm Core)
  const rayCount = 15;
  for (let i = 0; i < rayCount; i++) {
    const norm = rayCount > 1 ? i / (rayCount - 1) - 0.5 : 0; // -0.5 .. +0.5
    const centerFalloff = Math.cos(norm * Math.PI * 0.92); // brightest near center
    const waveA = Math.sin(timeSec * 1.15 + i * 1.67);
    const waveB = Math.cos(timeSec * 0.73 - i * 1.13);
    const pulse = 0.55 + 0.45 * (waveA * 0.6 + waveB * 0.4);

    const baseAngle = Math.PI * 0.5 + norm * spread * 2 + waveA * 0.022;
    const halfSpreadOuter = (0.042 + (i % 3) * 0.014) * (0.85 + 0.3 * pulse);
    const rayLen = maxLen * (0.78 + 0.22 * pulse);

    const endCenterX = originX + Math.cos(baseAngle) * rayLen;
    const endCenterY = originY + Math.sin(baseAngle) * rayLen;

    const alphaOuter = 0.105 * intensity * centerFalloff * pulse;
    if (alphaOuter > 0.004) {
      const grad = ctx.createLinearGradient(originX, originY, endCenterX, endCenterY);
      grad.addColorStop(0, `rgba(${coreRgb[0]}, ${coreRgb[1]}, ${coreRgb[2]}, ${(alphaOuter * 1.35).toFixed(3)})`);
      grad.addColorStop(0.35, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alphaOuter.toFixed(3)})`);
      grad.addColorStop(0.78, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(alphaOuter * 0.25).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(
        originX + Math.cos(baseAngle - halfSpreadOuter) * rayLen,
        originY + Math.sin(baseAngle - halfSpreadOuter) * rayLen
      );
      ctx.lineTo(
        originX + Math.cos(baseAngle + halfSpreadOuter) * rayLen,
        originY + Math.sin(baseAngle + halfSpreadOuter) * rayLen
      );
      ctx.closePath();
      ctx.fill();

      // Inner luminous core filament
      const halfSpreadCore = halfSpreadOuter * 0.36;
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(
        originX + Math.cos(baseAngle - halfSpreadCore) * (rayLen * 0.88),
        originY + Math.sin(baseAngle - halfSpreadCore) * (rayLen * 0.88)
      );
      ctx.lineTo(
        originX + Math.cos(baseAngle + halfSpreadCore) * (rayLen * 0.88),
        originY + Math.sin(baseAngle + halfSpreadCore) * (rayLen * 0.88)
      );
      ctx.closePath();
      ctx.fill();
    }
  }

  // 3. Subtle Volumetric Dust Motes Drifting Gently Inside the Light Cone
  for (let m = 0; m < 16; m++) {
    const seedX = ((m * 137.5) % 100) / 100;
    const seedY = ((m * 293.7) % 100) / 100;
    const my = (((seedY - timeSec * (0.032 + (m % 3) * 0.008)) % 1) + 1) % 1;
    const mx =
      0.16 +
      seedX * 0.68 +
      Math.sin(timeSec * 0.8 + m) * 0.025;
    const r = 1.6 + (m % 3) * 1.1;
    const twinkle = (0.35 + 0.65 * Math.abs(Math.sin(timeSec * 1.4 + m * 2.1))) * (1 - my * 0.7);
    ctx.beginPath();
    ctx.arc(mx * w, my * h * 0.78, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${coreRgb[0]}, ${coreRgb[1]}, ${coreRgb[2]}, ${(0.38 * intensity * twinkle).toFixed(3)})`;
    ctx.fill();
  }

  ctx.restore();
}

export function MediaStudio({ data, onRefresh }: MediaStudioProps) {
  const playableMatches = data.matches.filter(
    (m) => m.status !== 'bye' && m.teamAId && m.teamBId
  );

  const [step, setStep] = useState<StudioStep>(1);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(() => {
    return (
      playableMatches.find((m) => m.status === 'live')?.id ??
      playableMatches[0]?.id ??
      null
    );
  });
  const [ratio, setRatio] = useState<AspectRatio>('9:16');
  const [template, setTemplate] = useState<TemplateStyle>('live');
  const [colorFilter, setColorFilter] = useState<ColorFilterPreset>('original');
  const [photoCredit, setPhotoCredit] = useState('');
  const [selectedScheduleDayIdx, setSelectedScheduleDayIdx] = useState(0);
  const [selectedBracketTournamentId, setSelectedBracketTournamentId] = useState<number>(
    () => data.tournaments[0]?.id ?? 1
  );
  const [bracketFocus, setBracketFocus] = useState<BracketFocusMode>('auto_tour');
  const [activeFramingKey, setActiveFramingKey] = useState<string | null>(null);
  const [activeCanvasSlot, setActiveCanvasSlot] = useState(0);
  const [canvasDragging, setCanvasDragging] = useState(false);
  const [showGuideAccordion, setShowGuideAccordion] = useState(false);
  const [copiedSocialCaption, setCopiedSocialCaption] = useState(false);
  const [exportingBatchIg, setExportingBatchIg] = useState(false);
  const [stageTheme, setStageTheme] = useState<StageSelection>('auto');
  const [podiumVariant, setPodiumVariant] = useState<PodiumVariant>('champion_1');
  const [customSpotlightTeamId, setCustomSpotlightTeamId] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [includeIntro, setIncludeIntro] = useState(true);
  const [includeOutro, setIncludeOutro] = useState(true);
  const [showSafeZone, setShowSafeZone] = useState(true);

  // Non-Match / General Event Templates State
  const [cleanFrameShowFooter, setCleanFrameShowFooter] = useState(true);
  const [eventMomentBadge, setEventMomentBadge] = useState('OPENING CEREMONY');
  const [eventMomentTitle, setEventMomentTitle] = useState('AVERSA DIES NATALIS KE-44');
  const [eventMomentSubtitle, setEventMomentSubtitle] = useState(
    'SMA Negeri 1 Gedeg • Mojokerto'
  );
  const [venueRulesTitle, setVenueRulesTitle] = useState(
    'TATA TERTIB & LARANGAN ARENA'
  );
  const [venueRulesItems, setVenueRulesItems] = useState<string[]>([
    'Dilarang membawa makanan dan minuman dari luar area sekolah.',
    'Dilarang menerbangkan drone di area acara tanpa izin panitia.',
    'Dilarang merokok, menggunakan vape, dan membawa benda tajam.',
    'Wajib menjaga ketertiban, keamanan, dan kebersihan tribun.',
  ]);
  const [announcementBadge, setAnnouncementBadge] = useState('PENGUMUMAN');
  const [announcementTitle, setAnnouncementTitle] = useState('INFO PENONTON & ARENA');
  const [announcementBody, setAnnouncementBody] = useState(
    'Pintu tribun dibuka 30 menit sebelum pertandingan dimulai. Mohon patuhi arahan panitia di lapangan.'
  );

  // Multi-Photo (1-3) & Single Trimmed Video Clip State
  const [mediaMode, setMediaMode] = useState<StudioMediaMode>('photo');
  const [photoItems, setPhotoItems] = useState<
    Array<{ id: string; url: string; zoom?: number; panX?: number; panY?: number }>
  >([]);
  const [posterLayout, setPosterLayout] = useState<'collage' | 'single'>('collage');
  const [videoClip, setVideoClip] = useState<VideoClipState | null>(null);
  const [videoCoverImg, setVideoCoverImg] = useState<HTMLImageElement | null>(null);

  // Smart Auto-First BGM & ReactBits SFX State
  const [audioMode, setAudioMode] = useState<'auto' | 'manual' | 'none'>('auto');
  const [selectedTrackId, setSelectedTrackId] = useState<string>(
    () => pickSmartRandomTrack('live').id
  );
  const [bgmVolume, setBgmVolume] = useState(0.8);
  const [enableSfx, setEnableSfx] = useState(true);
  const [miniAudioPlaying, setMiniAudioPlaying] = useState(false);

  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [exportingVideo, setExportingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [exportedVideoBlob, setExportedVideoBlob] = useState<Blob | null>(null);
  const [exportedVideoExt, setExportedVideoExt] = useState<'mp4' | 'webm'>('webm');
  const [publishing, setPublishing] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<number | null>(null);
  const [convertingMedia, setConvertingMedia] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const canvasGestureRef = useRef<{
    slotIdx: number;
    lastX: number;
    lastY: number;
    pinchDist: number;
    pinchMidX: number;
    pinchMidY: number;
  }>({
    slotIdx: 0,
    lastX: 0,
    lastY: 0,
    pinchDist: 0,
    pinchMidX: 0,
    pinchMidY: 0,
  });
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastVideoFrameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastVideoResyncAtRef = useRef<number>(0);
  const previewRafRef = useRef<number>(0);
  const previewPlayingRef = useRef(false);
  const exportingVideoRef = useRef(false);
  const showSafeZoneRef = useRef(showSafeZone);
  previewPlayingRef.current = previewPlaying;
  exportingVideoRef.current = exportingVideo;
  showSafeZoneRef.current = showSafeZone;
  const vb3dRef = useRef<OffscreenVolleyballController | null>(null);
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const miniAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioStopRef = useRef<(() => void) | null>(null);

  const timeline = computeMediaTimeline({
    mediaMode,
    photoCount: Math.max(1, photoItems.length),
    clipDurationSec: videoClip
      ? Math.max(1, videoClip.trimEnd - videoClip.trimStart)
      : 6,
    includeIntro,
    includeOutro,
    skipScene3:
      template === 'schedule_day' ||
      template === 'bracket' ||
      isNonMatchTemplate(template),
    minScene4HoldSec:
      template === 'bracket' && bracketFocus === 'auto_tour' ? 11.4 : 0,
  });

  useEffect(() => {
    vb3dRef.current = createOffscreenVolleyball3D(512);
    return () => {
      vb3dRef.current?.dispose();
      vb3dRef.current = null;
    };
  }, []);

  const sponsorList: SponsorItem[] = (() => {
    try {
      return JSON.parse(data.settings?.sponsorsJson || '[]');
    } catch {
      return [];
    }
  })();

  const loadedAssetsRef = useRef<{
    photos: HTMLImageElement[];
    mainLogo: HTMLImageElement | null;
    coLogo: HTMLImageElement | null;
    organizerLogo: HTMLImageElement | null;
    burstRays: HTMLImageElement | null;
    arcsGold: HTMLImageElement | null;
    sparkles: HTMLImageElement | null;
    spikerOfficial: HTMLImageElement | null;
    ballOfficial: HTMLImageElement | null;
    netOfficial: HTMLImageElement | null;
    teamALogo: HTMLImageElement | null;
    teamBLogo: HTMLImageElement | null;
    podium1Logo: HTMLImageElement | null;
    podium2Logo: HTMLImageElement | null;
    podium3Logo: HTMLImageElement | null;
    teamLogos: Map<number, HTMLImageElement>;
    sponsors: Array<{ item: SponsorItem; img: HTMLImageElement | null }>;
  }>({
    photos: [],
    mainLogo: null,
    coLogo: null,
    organizerLogo: null,
    burstRays: null,
    arcsGold: null,
    sparkles: null,
    spikerOfficial: null,
    ballOfficial: null,
    netOfficial: null,
    teamALogo: null,
    teamBLogo: null,
    podium1Logo: null,
    podium2Logo: null,
    podium3Logo: null,
    teamLogos: new Map(),
    sponsors: [],
  });

  const activeMatch: Match | undefined =
    playableMatches.find((m) => m.id === selectedMatchId) ?? playableMatches[0];
  const [upcomingSchedule, setUpcomingSchedule] = useState<string>(
    () => activeMatch?.scheduledAt || ''
  );
  const [upcomingCourt, setUpcomingCourt] = useState<string>(
    () => activeMatch?.courtName || ''
  );

  // Auto-sync template style & match schedule/court with selected match (preserve 'champion', 'schedule_day' & non-match templates)
  useEffect(() => {
    if (!activeMatch) return;
    setTemplate((prev) => {
      if (
        prev === 'champion' ||
        prev === 'schedule_day' ||
        prev === 'bracket' ||
        isNonMatchTemplate(prev)
      )
        return prev;
      if (activeMatch.status === 'finished') return 'final';
      if (activeMatch.status === 'live') return 'live';
      return 'upcoming';
    });
    setUpcomingSchedule(activeMatch.scheduledAt || '');
    setUpcomingCourt(activeMatch.courtName || '');
  }, [
    activeMatch?.id,
    activeMatch?.status,
    activeMatch?.scheduledAt,
    activeMatch?.courtName,
  ]);

  // Smart Auto-Pick: automatically select a matching random track when match or template changes
  useEffect(() => {
    if (audioMode !== 'auto') return;
    const isFinalRound = Boolean(
      activeMatch && (activeMatch.nextMatchId === null || activeMatch.round >= 3)
    );
    const activeSetObj = activeMatch?.sets.find(
      (s) => s.setNumber === activeMatch.currentSet
    );
    const isTightScore = Boolean(
      activeSetObj &&
        activeSetObj.scoreA >= 20 &&
        activeSetObj.scoreB >= 20 &&
        Math.abs(activeSetObj.scoreA - activeSetObj.scoreB) <= 2
    );

    const audioTarget = toAudioTarget(template);
    setSelectedTrackId((prev) =>
      pickSmartRandomTrack(audioTarget, {
        excludeId: prev,
        isHighStakes: isFinalRound || isTightScore,
      }).id
    );
  }, [audioMode, template, activeMatch?.id]);

  const selectedTrack =
    AUDIO_TRACKS.find((t) => t.id === selectedTrackId) ?? AUDIO_TRACKS[0];
  const recommendedTracks = getTracksForTemplate(toAudioTarget(template));
  const recommendedIdSet = new Set(recommendedTracks.map((t) => t.id));
  const otherTracks = AUDIO_TRACKS.filter((t) => !recommendedIdSet.has(t.id));
  const teamMap = useMemo(
    () => new Map<number, Team>(data.teams.map((t) => [t.id, t])),
    [data.teams]
  );
  const teamA = activeMatch?.teamAId ? teamMap.get(activeMatch.teamAId) : null;
  const teamB = activeMatch?.teamBId ? teamMap.get(activeMatch.teamBId) : null;
  const tournament =
    data.tournaments.find((t) => t.id === activeMatch?.tournamentId) ??
    data.tournaments[0];

  const catMatches = data.matches.filter((m) => m.tournamentId === tournament?.id);
  const scheduleDayGroups = useMemo(() => {
    const cat = data.matches.filter((m) => m.tournamentId === tournament?.id);
    const source = (cat.length > 0 ? cat : data.matches).filter(
      (m) => m.status !== 'bye'
    );
    return groupMatchesByScheduleDay(source).dayGroups;
  }, [data.matches, tournament?.id]);
  const safeScheduleDayIdx = Math.min(
    selectedScheduleDayIdx,
    Math.max(0, scheduleDayGroups.length - 1)
  );
  const activeScheduleDay = scheduleDayGroups[safeScheduleDayIdx] ?? null;
  const SCHEDULE_ITEMS_PER_SLIDE = 4;
  const schedulePages = useMemo(() => {
    const allItems = activeScheduleDay?.items ?? [];
    if (allItems.length === 0) return [[]];
    const pages: typeof allItems[] = [];
    for (let i = 0; i < allItems.length; i += SCHEDULE_ITEMS_PER_SLIDE) {
      pages.push(allItems.slice(i, i + SCHEDULE_ITEMS_PER_SLIDE));
    }
    return pages;
  }, [activeScheduleDay]);
  const [scheduleSlideIdx, setScheduleSlideIdx] = useState(0);
  const safeScheduleSlideIdx = Math.min(
    scheduleSlideIdx,
    Math.max(0, schedulePages.length - 1)
  );
  const catTeams = data.teams.filter((t) => t.tournamentId === tournament?.id);
  const mainRoundNums = catMatches
    .filter((m) => m.bracketType === 'main')
    .map((m) => m.round);
  const totalMainRounds =
    mainRoundNums.length > 0 ? Math.max(...mainRoundNums) : 3;

  const bracketTournament =
    data.tournaments.find((t) => t.id === selectedBracketTournamentId) ??
    tournament;
  const bracketMatches = useMemo(
    () =>
      data.matches.filter(
        (m) => m.tournamentId === bracketTournament?.id && m.bracketType !== 'pool'
      ),
    [data.matches, bracketTournament?.id]
  );
  const bracketMainRounds = bracketMatches
    .filter((m) => m.bracketType === 'main')
    .map((m) => m.round);
  const bracketTotalRounds =
    bracketMainRounds.length > 0 ? Math.max(...bracketMainRounds) : 3;

  const effectiveStageKey: StagePresetKey =
    stageTheme === 'auto'
      ? detectMatchStageKey(activeMatch, totalMainRounds)
      : stageTheme;
  const stageMeta = STAGE_VISUAL_META[effectiveStageKey];
  const stageDisplayBadge =
    effectiveStageKey === 'pool' && activeMatch?.poolName
      ? `POOL ${activeMatch.poolName.toUpperCase()}`
      : stageMeta.badge;

  // Auto-resolve Podium Winners (1st Champion, 2nd Runner-Up, 3rd Place / Joint 3rd) for active category
  const podiumResolution = resolveTournamentPodium(
    { id: tournament?.id ?? 1, hasThirdPlace: tournament?.hasThirdPlace },
    catMatches,
    data.teams ?? []
  );

  const grandFinalMatch = catMatches.find(
    (m) => m.bracketType === 'main' && m.round === totalMainRounds
  );
  const thirdPlaceMatchObj = catMatches.find((m) => m.bracketType === 'third_place');

  const autoChampionTeam = podiumResolution.champion ??
    (grandFinalMatch?.winnerId
      ? teamMap.get(grandFinalMatch.winnerId) ?? null
      : activeMatch?.winnerId
        ? teamMap.get(activeMatch.winnerId) ?? null
        : teamA ?? catTeams[0] ?? null);

  const autoRunnerUpTeam = podiumResolution.runnerUp ??
    (grandFinalMatch?.winnerId && grandFinalMatch.teamAId && grandFinalMatch.teamBId
      ? teamMap.get(
          grandFinalMatch.winnerId === grandFinalMatch.teamAId
            ? grandFinalMatch.teamBId
            : grandFinalMatch.teamAId
        ) ?? null
      : teamB ?? catTeams[1] ?? null);

  const autoThirdTeam = podiumResolution.thirdPlace ??
    (thirdPlaceMatchObj?.winnerId
      ? teamMap.get(thirdPlaceMatchObj.winnerId) ?? null
      : thirdPlaceMatchObj?.teamAId
        ? teamMap.get(thirdPlaceMatchObj.teamAId) ?? null
        : podiumResolution.jointThirdTeams[0] ?? catTeams[2] ?? null);

  const spotlightOverrideTeam = customSpotlightTeamId
    ? teamMap.get(customSpotlightTeamId) ?? null
    : null;

  const resolvedPodium1 =
    podiumVariant === 'champion_1' && spotlightOverrideTeam
      ? spotlightOverrideTeam
      : autoChampionTeam;
  const resolvedPodium2 =
    podiumVariant === 'runner_up' && spotlightOverrideTeam
      ? spotlightOverrideTeam
      : autoRunnerUpTeam;
  const resolvedPodium3 =
    podiumVariant === 'third_place' && spotlightOverrideTeam
      ? spotlightOverrideTeam
      : autoThirdTeam;

  /**
   * Renders either:
   * - Static Poster (Scene 4 full photo + scoreboard) when isVideo = false
   * - Full 18-Second Zero-Hard-Cut Overlapping Broadcast Video with Three.js 3D Volleyball
   *   and ReactBits motion effects (SplitText, ShinyText, CircularText, Aurora, CountUp)
   */
  const renderFrame = useCallback(
    (
      timeSec: number,
      isVideo: boolean,
      drawGuides = false,
      ratioOverride?: AspectRatio
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const activeRatio = ratioOverride ?? ratio;
      const { w, h } = DIMENSIONS[activeRatio];
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const assets = loadedAssetsRef.current;
      const u = Math.min(w, h); // Consistent 1080 base unit across 9:16, 4:5, 16:9, & 1:1
      const pad = Math.round(u * 0.052);
      const isStory = activeRatio === '9:16';
      const isPost45 = activeRatio === '4:5';
      const isLandscape = activeRatio === '16:9';
      const isSquare = activeRatio === '1:1';
      // Safe Margins for Instagram Story / Reels (Top ~13% = 250px, Bottom ~15% = 288px on 1080x1920)
      const safeTop = isStory ? Math.round(h * 0.13) : pad;
      const safeBottom = isStory ? Math.round(h * 0.15) : pad;

      /**
       * Draws a live Three.js 3D PBR-lit Volleyball with genuine 3D topspin & perspective parallax
       * (with automatic fallback to 2D vector if WebGL is unavailable).
       */
      const drawBall3D = (
        cx: number,
        cy: number,
        diameter: number,
        rx: number,
        ry: number,
        rz: number,
        opts?: {
          alpha?: number;
          glowColor?: string;
          shadowFloorOffset?: number;
          camZ?: number;
        }
      ) => {
        if (diameter <= 2) return;
        const alpha = opts?.alpha ?? 1;
        if (alpha <= 0.005) return;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Soft floor contact shadow when requested
        if (opts?.shadowFloorOffset) {
          const sy = cy + opts.shadowFloorOffset;
          const sw = diameter * 0.42;
          const sh = diameter * 0.11;
          const sg = ctx.createRadialGradient(cx, sy, 0, cx, sy, sw);
          sg.addColorStop(0, 'rgba(15, 23, 42, 0.28)');
          sg.addColorStop(1, 'rgba(15, 23, 42, 0)');
          ctx.save();
          ctx.translate(cx, sy);
          ctx.scale(1, sh / Math.max(1, sw));
          ctx.beginPath();
          ctx.arc(0, 0, sw, 0, Math.PI * 2);
          ctx.fillStyle = sg;
          ctx.fill();
          ctx.restore();
        }

        // Optional golden/stadium halo behind the 3D sphere
        if (opts?.glowColor) {
          const gr = diameter * 0.78;
          const gg = ctx.createRadialGradient(cx, cy, diameter * 0.2, cx, cy, gr);
          gg.addColorStop(0, opts.glowColor);
          gg.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.arc(cx, cy, gr, 0, Math.PI * 2);
          ctx.fill();
        }

        const vb3d = vb3dRef.current;
        if (vb3d) {
          // Subtle 3D camera parallax based on ball screen position
          const normX = (cx / w - 0.5) * 2;
          const normY = (cy / h - 0.5) * 2;
          const glCanvas = vb3d.render({
            rx,
            ry,
            rz,
            camOffsetX: -normX * 0.42,
            camOffsetY: normY * 0.35,
            camZ: opts?.camZ ?? 3.85,
          });
          // Offscreen camera FOV=34 at z=3.85 frames sphere radius=1 as ~0.86 of canvas width
          const drawScale = 1.16;
          const dw = diameter * drawScale;
          ctx.shadowColor = 'rgba(15, 23, 42, 0.32)';
          ctx.shadowBlur = Math.round(diameter * 0.14);
          ctx.shadowOffsetY = Math.round(diameter * 0.05);
          ctx.drawImage(glCanvas, cx - dw / 2, cy - dw / 2, dw, dw);
        } else if (assets.ballOfficial) {
          ctx.translate(cx, cy);
          ctx.rotate(rz);
          ctx.drawImage(
            assets.ballOfficial,
            -diameter / 2,
            -diameter / 2,
            diameter,
            diameter
          );
        }
        ctx.restore();
      };

      const drawSafeZoneOverlay = () => {
        if (!drawGuides) return;

        if (canvasDragging && !isVideo) {
          const rects =
            mediaMode === 'video'
              ? [{ rx: 0, ry: 0, rw: w, rh: h }]
              : getCollageSlotRects(
                  Math.max(1, photoItems.length),
                  posterLayout,
                  w,
                  h,
                  safeTop,
                  safeBottom,
                  u,
                  isLandscape
                );
          const targetRect =
            rects[Math.min(activeCanvasSlot, rects.length - 1)] ?? rects[0]!;
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = Math.max(1.5, Math.round(u * 0.002));
          ctx.beginPath();
          for (let g = 1; g <= 2; g++) {
            const gx = targetRect.rx + (targetRect.rw * g) / 3;
            const gy = targetRect.ry + (targetRect.rh * g) / 3;
            ctx.moveTo(gx, targetRect.ry);
            ctx.lineTo(gx, targetRect.ry + targetRect.rh);
            ctx.moveTo(targetRect.rx, gy);
            ctx.lineTo(targetRect.rx + targetRect.rw, gy);
          }
          ctx.stroke();
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.95)';
          ctx.lineWidth = Math.max(4, Math.round(u * 0.0045));
          ctx.strokeRect(
            targetRect.rx + 2,
            targetRect.ry + 2,
            Math.max(4, targetRect.rw - 4),
            Math.max(4, targetRect.rh - 4)
          );
          ctx.restore();
        }

        if (!isStory) return;
        ctx.save();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
        ctx.fillRect(0, 0, w, safeTop);
        ctx.fillRect(0, h - safeBottom, w, safeBottom);

        ctx.setLineDash([14, 10]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(245, 197, 56, 0.85)';
        ctx.beginPath();
        ctx.moveTo(0, safeTop);
        ctx.lineTo(w, safeTop);
        ctx.moveTo(0, h - safeBottom);
        ctx.lineTo(w, h - safeBottom);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(245, 197, 56, 0.92)';
        ctx.font = `700 ${Math.round(w * 0.019)}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText('BATAS AMAN ATAS IG STORY (PRATINJAU)', w - 24, safeTop - 12);
        ctx.fillText('BATAS AMAN BAWAH IG STORY (PRATINJAU)', w - 24, h - safeBottom + 28);
        ctx.restore();
      };

      const activeSet = activeMatch?.sets.find(
        (s) => s.setNumber === activeMatch.currentSet
      );
      const scoreA =
        template === 'final'
          ? (activeMatch?.setsWonA ?? 0)
          : (activeSet?.scoreA ?? activeMatch?.setsWonA ?? 0);
      const scoreB =
        template === 'final'
          ? (activeMatch?.setsWonB ?? 0)
          : (activeSet?.scoreB ?? activeMatch?.setsWonB ?? 0);

      const resolvedCourtLabel = (
        upcomingCourt.trim() ||
        activeMatch?.courtName?.trim() ||
        'Arena Utama'
      );
      const resolvedScheduleLabel = (
        upcomingSchedule.trim() ||
        activeMatch?.scheduledAt?.trim() ||
        'Segera Bertanding'
      );
      const upcomingScheduleAndCourt = `${resolvedScheduleLabel} • ${resolvedCourtLabel}`;

      // Helper: Draw any Image or Video element center-cropped ("object-cover") inside a clipped rect
      const drawMediaCoverRect = (
        source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
        rx: number,
        ry: number,
        rw: number,
        rh: number,
        zoom = 1,
        panX = 0,
        panY = 0
      ) => {
        const srcW =
          source instanceof HTMLVideoElement ? source.videoWidth : source.width;
        const srcH =
          source instanceof HTMLVideoElement ? source.videoHeight : source.height;
        if (srcW <= 0 || srcH <= 0 || rw <= 0 || rh <= 0) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();

        const cssFilter = COLOR_FILTER_MAP[colorFilter]?.css ?? 'none';
        if (cssFilter !== 'none') {
          ctx.filter = cssFilter;
        }

        const safeZoom = Math.max(1, zoom);
        const { maxPanX, maxPanY } = computeMaxPanFractions(srcW, srcH, rw, rh, safeZoom);
        const clampedPanX = Math.max(-maxPanX * rw, Math.min(maxPanX * rw, panX));
        const clampedPanY = Math.max(-maxPanY * rh, Math.min(maxPanY * rh, panY));

        const srcAspect = srcW / srcH;
        const rectAspect = rw / rh;
        let dw = rw;
        let dh = rh;
        if (srcAspect > rectAspect) {
          dh = rh * safeZoom;
          dw = dh * srcAspect;
        } else {
          dw = rw * safeZoom;
          dh = dw / srcAspect;
        }
        ctx.drawImage(
          source,
          rx + (rw - dw) / 2 + clampedPanX,
          ry + (rh - dh) / 2 + clampedPanY,
          dw,
          dh
        );
        ctx.filter = 'none';
        ctx.restore();
      };

      const getPhotoFraming = (idx: number) => {
        const it = photoItems[idx];
        return {
          zoom: it?.zoom ?? 1,
          panX: it?.panX ?? 0,
          panY: it?.panY ?? 0,
        };
      };

      const computeKenBurnsTransform = (
        slideIdx: number,
        prog: number,
        entrySettleBoost = 0
      ) => {
        // Linear + cosine drift (never freezes at t=0 when Scene 3 doors open!)
        const p = clamp01(prog);
        const settleZoom = entrySettleBoost * 0.065;
        if (slideIdx % 3 === 0) {
          return {
            zoom: 1.12 - 0.09 * p + settleZoom,
            panX: Math.sin(p * Math.PI) * (w * 0.018),
            panY: 0,
          };
        }
        if (slideIdx % 3 === 1) {
          return {
            zoom: 1.03 + 0.08 * p + settleZoom,
            panX: (0.5 - p) * (w * 0.026),
            panY: 0,
          };
        }
        return {
          zoom: 1.11 - 0.08 * p + settleZoom,
          panX: 0,
          panY: (0.5 - p) * (h * 0.022),
        };
      };

      // ================================================================
      // SCENE 4 & STATIC POSTER LAYER: Multi-Photo / Trimmed Video + Scoreboard
      // ================================================================
      const drawPhotoAndScoreboard = (
        elapsedInScene4: number,
        uiProgress: number,
        animSlide: boolean,
        globalT = 0
      ) => {
        ctx.fillStyle = '#0B0F19';
        ctx.fillRect(0, 0, w, h);

        const validPhotos = assets.photos;
        let activeSlideIndicator: { current: number; total: number } | null = null;

        if (mediaMode === 'video') {
          const vidEl = hiddenVideoRef.current;
          const canDrawLiveVideo =
            animSlide &&
            vidEl &&
            vidEl.readyState >= 2 &&
            !vidEl.seeking &&
            vidEl.videoWidth > 0 &&
            vidEl.videoHeight > 0;
          if (canDrawLiveVideo) {
            let cacheCanvas = lastVideoFrameCanvasRef.current;
            if (!cacheCanvas) {
              cacheCanvas = document.createElement('canvas');
              lastVideoFrameCanvasRef.current = cacheCanvas;
            }
            if (
              cacheCanvas.width !== vidEl.videoWidth ||
              cacheCanvas.height !== vidEl.videoHeight
            ) {
              cacheCanvas.width = vidEl.videoWidth;
              cacheCanvas.height = vidEl.videoHeight;
            }
            const cacheCtx = cacheCanvas.getContext('2d');
            if (cacheCtx) {
              cacheCtx.drawImage(vidEl, 0, 0, vidEl.videoWidth, vidEl.videoHeight);
            }
          }
          const cachedVideoFrame =
            animSlide &&
            lastVideoFrameCanvasRef.current &&
            lastVideoFrameCanvasRef.current.width > 0
              ? lastVideoFrameCanvasRef.current
              : null;
          const vidSource = canDrawLiveVideo
            ? vidEl
            : cachedVideoFrame ?? videoCoverImg;

          if (vidSource) {
            const settle = animSlide
              ? 1 - easeOutQuint(clamp01(elapsedInScene4 / 1.15))
              : 0;
            const breathe = animSlide
              ? 1.03 -
                0.03 * clamp01(elapsedInScene4 / Math.max(1, timeline.scene4HoldSec)) +
                settle * 0.055
              : 1;
            const vZoom = breathe * (videoClip?.zoom ?? 1);
            const vPanX = (videoClip?.panX ?? 0) * w;
            const vPanY = (videoClip?.panY ?? 0) * h;
            drawMediaCoverRect(vidSource, 0, 0, w, h, vZoom, vPanX, vPanY);
          } else {
            ctx.fillStyle = '#0F172A';
            ctx.fillRect(0, 0, w, h);
            drawAuroraAndBokeh(ctx, w, h, globalT, 0.85, 'dark');
            ctx.fillStyle = '#94A3B8';
            ctx.font = `bold ${Math.round(u * 0.034)}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('Pilih Klip Video di Langkah 1', w / 2, h / 2);
          }
        } else if (validPhotos.length === 0) {
          ctx.fillStyle = '#0F172A';
          ctx.fillRect(0, 0, w, h);
          drawAuroraAndBokeh(ctx, w, h, globalT, 0.85, 'dark');
          if (template !== 'schedule_day') {
            ctx.fillStyle = '#94A3B8';
            ctx.font = `bold ${Math.round(u * 0.034)}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('Unggah 1 - 3 Foto di Langkah 1', w / 2, h / 2);
          }
        } else if (!animSlide && validPhotos.length >= 2 && posterLayout === 'collage') {
          // Static Poster Collage Grid (2 or 3 Photos with Crisp Golden Broadcast Dividers)
          const slotRects = getCollageSlotRects(
            validPhotos.length,
            posterLayout,
            w,
            h,
            safeTop,
            safeBottom,
            u,
            isLandscape
          );
          ctx.save();
          slotRects.forEach((sr, sIdx) => {
            const img = validPhotos[sIdx];
            if (!img) return;
            const fr = getPhotoFraming(sIdx);
            drawMediaCoverRect(
              img,
              sr.rx,
              sr.ry,
              sr.rw,
              sr.rh,
              fr.zoom,
              fr.panX * sr.rw,
              fr.panY * sr.rh
            );
          });
          ctx.strokeStyle = '#F5C538';
          ctx.lineWidth = Math.max(4, Math.round(u * 0.0045));
          ctx.beginPath();
          if (slotRects.length === 2) {
            const r1 = slotRects[1]!;
            if (isLandscape) {
              ctx.moveTo(r1.rx, 0);
              ctx.lineTo(r1.rx, h);
            } else {
              ctx.moveTo(0, r1.ry);
              ctx.lineTo(w, r1.ry);
            }
          } else if (slotRects.length >= 3) {
            const r1 = slotRects[1]!;
            const r2 = slotRects[2]!;
            if (isLandscape) {
              ctx.moveTo(r1.rx, 0);
              ctx.lineTo(r1.rx, h);
              ctx.moveTo(r1.rx, r2.ry);
              ctx.lineTo(w, r2.ry);
            } else {
              ctx.moveTo(0, r1.ry);
              ctx.lineTo(w, r1.ry);
              ctx.moveTo(r2.rx, r1.ry);
              ctx.lineTo(r2.rx, h);
            }
          }
          ctx.stroke();
          ctx.restore();
        } else if (!animSlide) {
          // Single Hero Cover Photo
          const f0 = getPhotoFraming(0);
          drawMediaCoverRect(validPhotos[0]!, 0, 0, w, h, f0.zoom, f0.panX * w, f0.panY * h);
        } else {
          // Animated Multi-Photo Slideshow inside Video Scene 4 (Diagonal Golden Wipe)
          const slide = computePhotoSlideState(
            validPhotos.length,
            elapsedInScene4,
            timeline.scene4HoldSec
          );
          const entrySettle =
            slide.primaryIdx === 0
              ? 1 - easeOutQuint(clamp01(elapsedInScene4 / 1.15))
              : 0;
          const curImg = validPhotos[slide.primaryIdx] ?? validPhotos[0]!;
          const kbCur = computeKenBurnsTransform(
            slide.primaryIdx,
            slide.localProgressPrimary,
            entrySettle
          );
          const pfCur = getPhotoFraming(slide.primaryIdx);
          drawMediaCoverRect(
            curImg,
            0,
            0,
            w,
            h,
            kbCur.zoom * pfCur.zoom,
            kbCur.panX + pfCur.panX * w,
            kbCur.panY + pfCur.panY * h
          );

          if (slide.nextIdx !== null && slide.wipeProgress > 0) {
            const nextImg = validPhotos[slide.nextIdx];
            if (nextImg) {
              const kbNext = computeKenBurnsTransform(slide.nextIdx, slide.localProgressNext);
              const pfNext = getPhotoFraming(slide.nextIdx);
              const easedWipe = easeFluidCurtain(slide.wipeProgress);
              const leadX = -w * 0.35 + easedWipe * (w * 1.95);

              ctx.save();
              ctx.beginPath();
              ctx.moveTo(-w * 0.5, 0);
              ctx.lineTo(leadX, 0);
              ctx.lineTo(leadX - w * 0.28, h);
              ctx.lineTo(-w * 0.78, h);
              ctx.closePath();
              ctx.clip();
              drawMediaCoverRect(
                nextImg,
                0,
                0,
                w,
                h,
                kbNext.zoom * pfNext.zoom,
                kbNext.panX + pfNext.panX * w,
                kbNext.panY + pfNext.panY * h
              );
              ctx.restore();

              // Crisp Gold Wipe Edge
              ctx.save();
              ctx.fillStyle = '#F5C538';
              ctx.beginPath();
              ctx.moveTo(leadX - w * 0.024, 0);
              ctx.lineTo(leadX + w * 0.012, 0);
              ctx.lineTo(leadX - w * 0.268, h);
              ctx.lineTo(leadX - w * 0.304, h);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
          }

          if (validPhotos.length >= 2) {
            activeSlideIndicator = {
              current:
                slide.wipeProgress > 0.5 && slide.nextIdx !== null
                  ? slide.nextIdx
                  : slide.primaryIdx,
              total: validPhotos.length,
            };
          }
        }

        // Scrims (extended to respect safeTop & safeBottom across all 4 ratios)
        const topScrimH = safeTop + Math.round(u * 0.22);
        const topGrad = ctx.createLinearGradient(0, 0, 0, topScrimH);
        topGrad.addColorStop(0, 'rgba(11, 15, 25, 0.92)');
        topGrad.addColorStop(0.65, 'rgba(11, 15, 25, 0.55)');
        topGrad.addColorStop(1, 'rgba(11, 15, 25, 0)');
        ctx.fillStyle = topGrad;
        ctx.fillRect(0, 0, w, topScrimH);

        const botScrimStart = Math.max(0, h - safeBottom - Math.round(u * 0.42));
        const botGrad = ctx.createLinearGradient(0, botScrimStart, 0, h);
        botGrad.addColorStop(0, 'rgba(11, 15, 25, 0)');
        botGrad.addColorStop(0.45, 'rgba(11, 15, 25, 0.78)');
        botGrad.addColorStop(1, 'rgba(11, 15, 25, 0.96)');
        ctx.fillStyle = botGrad;
        ctx.fillRect(0, botScrimStart, w, h - botScrimStart);

        if (animSlide) {
          drawAuroraAndBokeh(ctx, w, h, globalT, 0.45 * uiProgress, 'dark');
        }
        if (template === 'champion' || effectiveStageKey === 'final') {
          drawReactBitsLightRays(ctx, w, h, globalT, {
            intensity: animSlide ? 0.36 * clamp01(uiProgress * 1.15) : 0.34,
            palette:
              template === 'champion' && podiumVariant === 'runner_up'
                ? 'silver'
                : template === 'champion' && podiumVariant === 'third_place'
                  ? 'bronze'
                  : 'gold',
            rayLengthRatio: 0.78,
          });
        }

        // Top Brand Watermark (SVC + AVERSA) with Strict Anti-Collision Bounding Box
        const wmEase = animSlide ? easeOutQuint(clamp01(uiProgress / 0.75)) : 1;
        const wmShift = animSlide ? (1 - wmEase) * -32 : 0;
        ctx.save();
        ctx.globalAlpha = wmEase;
        ctx.translate(0, wmShift);

        const lSize = Math.round(u * 0.094);
        if (assets.mainLogo) {
          ctx.drawImage(assets.mainLogo, pad, safeTop, lSize, lSize);
        }

        let rightReservedX = w - pad;
        if (assets.coLogo) {
          const cH = Math.round(u * 0.058);
          const cW = Math.round(cH * (assets.coLogo.width / Math.max(1, assets.coLogo.height)));
          const cX = w - pad - cW;
          const cY = safeTop + Math.round((lSize - cH) / 2);
          ctx.drawImage(assets.coLogo, cX, cY, cW, cH);
          rightReservedX = cX - Math.round(u * 0.026);
        }

        ctx.textAlign = 'left';
        const titleX = assets.mainLogo ? pad + lSize + Math.round(u * 0.022) : pad;
        const maxHeaderTextW = Math.max(180, rightReservedX - titleX);

        const fittedHeaderTitle = fitSingleLine(
          ctx,
          (data.settings?.eventName || 'SMANSAGE VOLLEYBALL COMPETITION').toUpperCase(),
          maxHeaderTextW,
          Math.round(u * 0.036),
          Math.round(u * 0.02),
          '800 {SIZE}px "Barlow Condensed", sans-serif'
        );
        ctx.fillStyle = '#F5C538';
        ctx.font = `800 ${fittedHeaderTitle.fontSize}px "Barlow Condensed", sans-serif`;
        ctx.fillText(
          fittedHeaderTitle.text,
          titleX,
          safeTop + Math.round(lSize * 0.44)
        );

        const headerSubStr =
          template === 'champion'
            ? `${tournament?.name || 'SVC'} • OFFICIAL CHAMPIONSHIP PODIUM`
            : template === 'schedule_day'
              ? `${tournament?.name || 'SVC'} • JADWAL ${activeScheduleDay?.dayLabel?.toUpperCase() || 'PERTANDINGAN'}`
              : `${tournament?.name || 'SVC'} • ${stageDisplayBadge} • ${data.settings?.eventSubtitle || 'AVERSA Dies Natalis 44'}`;

        const fittedHeaderSub = fitSingleLine(
          ctx,
          headerSubStr,
          maxHeaderTextW,
          Math.round(u * 0.024),
          Math.round(u * 0.015),
          '600 {SIZE}px "Plus Jakarta Sans", sans-serif'
        );
        ctx.fillStyle = '#E2E8F0';
        ctx.font = `600 ${fittedHeaderSub.fontSize}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillText(
          fittedHeaderSub.text,
          titleX,
          safeTop + Math.round(lSize * 0.78)
        );
        ctx.restore();

        // Photographer / Videographer Credit Badge (bottom-right safe zone)
        if (photoCredit.trim()) {
          ctx.save();
          const creditStr = `Foto/Video: ${photoCredit.trim()}`;
          const cFontSize = Math.round(u * 0.019);
          ctx.font = `700 ${cFontSize}px "Plus Jakarta Sans", sans-serif`;
          const cTextW = ctx.measureText(creditStr).width;
          const cPadX = Math.round(u * 0.016);
          const cPillW = Math.min(w - pad * 2, cTextW + cPadX * 2);
          const cPillH = Math.round(u * 0.036);
          const cPillX = w - pad - cPillW;
          const cPillY = safeTop + Math.round(lSize * 1.12);
          drawRoundedRect(ctx, cPillX, cPillY, cPillW, cPillH, 999);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.45)';
          ctx.stroke();
          ctx.fillStyle = '#FDE68A';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            creditStr,
            cPillX + cPillW / 2,
            cPillY + cPillH / 2 + 1,
            cPillW - cPadX * 2
          );
          ctx.restore();
        }

        // Scoreboard / Championship Coronation Card: Sized strictly from `u` & `boxH`
        const cardT = animSlide ? clamp01((uiProgress - 0.08) / 0.85) : 1;
        if (cardT <= 0.001) return;

        // Dedicated Daily Schedule Card Renderer (template === 'schedule_day')
        // Max 4 matches per slide, cycles automatically in Video mode, includes Team Logos!
        if (template === 'schedule_day') {
          const totalSlides = Math.max(1, schedulePages.length);
          let activePageIdx = safeScheduleSlideIdx;
          let slideFadeAlpha = 1;

          if (isVideo && totalSlides > 1) {
            const schedDur = Math.max(2, timeline.outroStartSec - 4.4);
            const perSlideDur = schedDur / totalSlides;
            const localT = Math.max(0, timeSec - 4.4);
            activePageIdx = Math.min(totalSlides - 1, Math.floor(localT / perSlideDur));
            const slideElapsed = localT - activePageIdx * perSlideDur;
            const enterAlpha = easeOutCubic(clamp01(slideElapsed / 0.35));
            const exitAlpha =
              activePageIdx < totalSlides - 1 && slideElapsed > perSlideDur - 0.3
                ? 1 - easeInOutCubic(clamp01((slideElapsed - (perSlideDur - 0.3)) / 0.3))
                : 1;
            slideFadeAlpha = enterAlpha * exitAlpha;
          }

          const dayItems = schedulePages[activePageIdx] ?? [];
          const cardTop = safeTop + Math.round(u * (photoCredit.trim() ? 0.165 : 0.13));
          const cardBot = h - safeBottom - Math.round(u * 0.025);
          const cardH = Math.max(260, cardBot - cardTop);
          const cardW = isLandscape ? Math.round(w * 0.84) : w - pad * 2;
          const cardX = Math.round((w - cardW) / 2);
          const slideOffset = (1 - easeOutQuint(cardT)) * 90;
          const cardY = cardTop + slideOffset;

          ctx.save();
          ctx.globalAlpha = easeOutCubic(cardT);
          drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 26);
          ctx.fillStyle = 'rgba(11, 16, 30, 0.94)';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.82)';
          ctx.stroke();

          // Pill Header
          const pillH = Math.round(u * 0.048);
          const pillW = Math.min(cardW * 0.84, Math.round(u * 0.66));
          const pillX = w / 2 - pillW / 2;
          const pillY = cardY - pillH / 2;
          drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 999);
          ctx.fillStyle = '#F5C538';
          ctx.fill();

          const slideSuffix = totalSlides > 1 ? ` • SLIDE ${activePageIdx + 1}/${totalSlides}` : '';
          const dayPillLabel = `JADWAL • ${(activeScheduleDay?.dayLabel || 'HARI INI').toUpperCase()}${slideSuffix}`;
          const fittedDayPill = fitSingleLine(
            ctx,
            dayPillLabel,
            pillW - 28,
            Math.round(pillH * 0.44),
            Math.round(pillH * 0.28),
            '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.fillStyle = '#0B0F19';
          ctx.font = `800 ${fittedDayPill.fontSize}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fittedDayPill.text, w / 2, pillY + pillH / 2 + 1);
          ctx.textBaseline = 'alphabetic';

          // Schedule Rows Area (Max 4 generous cards with Team Logos)
          const innerPadX = Math.round(cardW * 0.04);
          const headerSpace = Math.round(u * 0.042);
          const footerSpace = caption.trim() ? Math.round(u * 0.052) : Math.round(u * 0.025);
          const listTop = cardY + headerSpace;
          const listAvailH = Math.max(120, cardH - headerSpace - footerSpace);
          const count = Math.max(1, dayItems.length);
          const rowGap = Math.max(10, Math.round(listAvailH * 0.032));
          const rowH = Math.min(
            Math.round(u * 0.22),
            Math.floor((listAvailH - rowGap * (count - 1)) / count)
          );
          const totalListH = count * rowH + Math.max(0, count - 1) * rowGap;
          const startRowY = listTop + Math.max(0, Math.round((listAvailH - totalListH) / 2));

          ctx.save();
          ctx.globalAlpha *= slideFadeAlpha;

          if (dayItems.length === 0) {
            ctx.fillStyle = '#94A3B8';
            ctx.font = `700 ${Math.round(u * 0.028)}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('Belum ada jadwal di hari terpilih', w / 2, listTop + listAvailH / 2);
          } else {
            dayItems.forEach(({ match: dm, parsed }, idx) => {
              const ry = startRowY + idx * (rowH + rowGap);
              const rx = cardX + innerPadX;
              const rw = cardW - innerPadX * 2;

              // Row Card Surface
              drawRoundedRect(ctx, rx, ry, rw, rowH, 16);
              ctx.fillStyle =
                dm.status === 'live'
                  ? 'rgba(220, 38, 38, 0.22)'
                  : 'rgba(255, 255, 255, 0.07)';
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle =
                dm.status === 'live'
                  ? 'rgba(248, 113, 113, 0.65)'
                  : 'rgba(245, 197, 56, 0.25)';
              ctx.stroke();

              // Top Meta Strip inside Row: Time Pill (Left) + Stage & Court (Right)
              const metaBarH = Math.round(rowH * 0.28);
              const metaPadX = Math.round(rw * 0.025);
              const metaTopY = ry + Math.round(rowH * 0.07);
              const timeStr = dm.status === 'live' ? 'LIVE NOW' : (parsed.timeLabel || dm.courtName || 'TBA');

              ctx.font = `800 ${Math.max(12, Math.round(metaBarH * 0.56))}px "Plus Jakarta Sans", sans-serif`;
              const measuredTimeW = ctx.measureText(timeStr).width;
              const timePillW = Math.min(Math.round(rw * 0.44), Math.round(measuredTimeW + 24));
              drawRoundedRect(ctx, rx + metaPadX, metaTopY, timePillW, metaBarH, 8);
              ctx.fillStyle = dm.status === 'live' ? '#DC2626' : 'rgba(245, 197, 56, 0.22)';
              ctx.fill();

              const fittedTime = fitSingleLine(
                ctx,
                timeStr,
                timePillW - 14,
                Math.round(metaBarH * 0.56),
                11,
                '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
              );
              ctx.fillStyle = dm.status === 'live' ? '#FFFFFF' : '#FACC15';
              ctx.font = `800 ${fittedTime.fontSize}px "Plus Jakarta Sans", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(fittedTime.text, rx + metaPadX + timePillW / 2, metaTopY + metaBarH / 2 + 1);

              const subLine = `${dm.stageLabel || formatInternationalStageLabel(dm, totalMainRounds)} • ${dm.courtName}`;
              const stageMaxW = Math.max(80, rw - metaPadX * 2 - timePillW - 16);
              const fittedSub = fitSingleLine(
                ctx,
                subLine,
                stageMaxW,
                Math.round(metaBarH * 0.52),
                10,
                '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
              );
              ctx.fillStyle = '#CBD5E1';
              ctx.font = `700 ${fittedSub.fontSize}px "Plus Jakarta Sans", sans-serif`;
              ctx.textAlign = 'right';
              ctx.fillText(fittedSub.text, rx + rw - metaPadX, metaTopY + metaBarH / 2 + 1);

              // Main Matchup Band (Bottom 65% of Row): [Logo A] Team A   VS/Score   Team B [Logo B]
              const bodyCenterY = ry + Math.round(rowH * 0.67);
              const centerX = rx + rw / 2;
              const centerPillW = Math.round(Math.min(72, rw * 0.11));
              const centerPillH = Math.round(rowH * 0.28);

              // Center VS or Score Pill
              drawRoundedRect(
                ctx,
                centerX - centerPillW / 2,
                bodyCenterY - centerPillH / 2,
                centerPillW,
                centerPillH,
                999
              );
              ctx.fillStyle = dm.status === 'finished' ? '#F5C538' : 'rgba(255, 255, 255, 0.14)';
              ctx.fill();

              const centerTxt = dm.status === 'finished' ? `${dm.setsWonA} : ${dm.setsWonB}` : 'VS';
              ctx.fillStyle = dm.status === 'finished' ? '#0B0F19' : '#FACC15';
              ctx.font = `800 ${Math.round(centerPillH * 0.58)}px "Barlow Condensed", sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillText(centerTxt, centerX, bodyCenterY + 1);

              const tAObj = dm.teamAId ? teamMap.get(dm.teamAId) : undefined;
              const tBObj = dm.teamBId ? teamMap.get(dm.teamBId) : undefined;
              const tAName = tAObj?.name || 'TBD';
              const tBName = tBObj?.name || 'TBD';
              const logoImgA = dm.teamAId ? assets.teamLogos.get(dm.teamAId) ?? null : null;
              const logoImgB = dm.teamBId ? assets.teamLogos.get(dm.teamBId) ?? null : null;

              const logoSize = Math.round(Math.min(rowH * 0.44, rw * 0.085));
              const sideInnerPad = Math.round(rw * 0.025);
              const logoToTextGap = Math.round(rw * 0.018);
              const vsGap = Math.round(rw * 0.02);

              // Left Side: Logo A + Team A Name
              const leftStartX = rx + sideInnerPad;
              const leftEndX = centerX - centerPillW / 2 - vsGap;
              const drawTeamBadge = (
                bx: number,
                by: number,
                size: number,
                img: HTMLImageElement | null,
                fallbackName: string
              ) => {
                ctx.save();
                drawRoundedRect(ctx, bx, by, size, size, Math.round(size * 0.22));
                ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
                ctx.fill();
                if (img && img.width > 0 && img.height > 0) {
                  const padImg = Math.round(size * 0.1);
                  const maxBox = size - padImg * 2;
                  const scale = Math.min(maxBox / img.width, maxBox / img.height);
                  const dw = img.width * scale;
                  const dh = img.height * scale;
                  ctx.drawImage(img, bx + (size - dw) / 2, by + (size - dh) / 2, dw, dh);
                } else {
                  ctx.fillStyle = '#0F172A';
                  ctx.font = `800 ${Math.round(size * 0.42)}px "Barlow Condensed", sans-serif`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(fallbackName.slice(0, 2).toUpperCase(), bx + size / 2, by + size / 2 + 1);
                }
                ctx.restore();
              };

              drawTeamBadge(leftStartX, bodyCenterY - logoSize / 2, logoSize, logoImgA, tAName);
              const textLeftStart = leftStartX + logoSize + logoToTextGap;
              const textLeftAvailW = Math.max(50, leftEndX - textLeftStart);
              const fittedA = fitSingleLine(
                ctx,
                tAName,
                textLeftAvailW,
                Math.round(rowH * 0.28),
                12,
                '800 {SIZE}px "Barlow Condensed", sans-serif'
              );
              ctx.fillStyle = '#FFFFFF';
              ctx.font = `800 ${fittedA.fontSize}px "Barlow Condensed", sans-serif`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(fittedA.text, textLeftStart, bodyCenterY + 1);

              // Right Side: Team B Name + Logo B
              const rightStartX = centerX + centerPillW / 2 + vsGap;
              const rightLogoX = rx + rw - sideInnerPad - logoSize;
              drawTeamBadge(rightLogoX, bodyCenterY - logoSize / 2, logoSize, logoImgB, tBName);
              const textRightEnd = rightLogoX - logoToTextGap;
              const textRightAvailW = Math.max(50, textRightEnd - rightStartX);
              const fittedB = fitSingleLine(
                ctx,
                tBName,
                textRightAvailW,
                Math.round(rowH * 0.28),
                12,
                '800 {SIZE}px "Barlow Condensed", sans-serif'
              );
              ctx.fillStyle = '#FFFFFF';
              ctx.font = `800 ${fittedB.fontSize}px "Barlow Condensed", sans-serif`;
              ctx.textAlign = 'right';
              ctx.textBaseline = 'middle';
              ctx.fillText(fittedB.text, textRightEnd, bodyCenterY + 1);
              ctx.textBaseline = 'alphabetic';
            });
          }

          ctx.restore();

          if (caption.trim()) {
            const fittedCap = fitSingleLine(
              ctx,
              caption.trim(),
              cardW - 36,
              Math.round(u * 0.024),
              Math.round(u * 0.016),
              '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
            );
            ctx.fillStyle = '#FDE68A';
            ctx.font = `700 ${fittedCap.fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(fittedCap.text, w / 2, cardY + cardH - Math.round(u * 0.018));
          }
          ctx.restore();
          return;
        }

        // Dedicated Cinematic Symmetric Bracket Renderer (template === 'bracket')
        if (template === 'bracket') {
          let viewMode: 'left' | 'right' | 'finals' | 'full' = 'left';
          let actProgress = 1;
          let actFade = 1;

          if (isVideo && bracketFocus === 'auto_tour') {
            const tourDur = Math.max(3, timeline.outroStartSec - timeline.scene4StartSec);
            const pTour = clamp01(elapsedInScene4 / tourDur);
            if (pTour < 0.36) {
              viewMode = 'left';
              actProgress = clamp01(pTour / 0.24);
              const localExit = pTour > 0.32 ? 1 - clamp01((pTour - 0.32) / 0.04) : 1;
              actFade = clamp01(pTour / 0.05) * localExit;
            } else if (pTour < 0.72) {
              viewMode = 'right';
              const rel = pTour - 0.36;
              actProgress = clamp01(rel / 0.24);
              const localExit = rel > 0.32 ? 1 - clamp01((rel - 0.32) / 0.04) : 1;
              actFade = clamp01(rel / 0.05) * localExit;
            } else {
              viewMode = 'finals';
              const rel = pTour - 0.72;
              actProgress = clamp01(rel / 0.22);
              actFade = clamp01(rel / 0.05);
            }
          } else if (!isVideo && bracketFocus === 'auto_tour') {
            viewMode = isLandscape ? 'full' : 'left';
            actProgress = 1;
            actFade = 1;
          } else {
            viewMode = bracketFocus === 'auto_tour' ? 'left' : bracketFocus;
            actProgress = isVideo ? clamp01(elapsedInScene4 / 1.4) : 1;
            actFade = 1;
          }

          const cardTop = safeTop + Math.round(u * (photoCredit.trim() ? 0.16 : 0.125));
          const cardBot = h - safeBottom - Math.round(u * 0.022);
          const cardH = Math.max(260, cardBot - cardTop);
          const cardW = isLandscape ? Math.round(w * 0.92) : w - pad * 1.6;
          const cardX = Math.round((w - cardW) / 2);
          const slideOffset = (1 - easeOutQuint(cardT)) * 85;
          const cardY = cardTop + slideOffset;

          ctx.save();
          ctx.globalAlpha = easeOutCubic(cardT);
          drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 24);
          ctx.fillStyle = 'rgba(11, 16, 30, 0.92)';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.8)';
          ctx.stroke();

          const viewBadgeLabel =
            viewMode === 'left'
              ? 'BAGAN KIRI • POOL A'
              : viewMode === 'right'
                ? 'BAGAN KANAN • POOL B'
                : viewMode === 'finals'
                  ? 'GRAND FINAL & JUARA 3'
                  : 'BAGAN PENUH';
          const pillH = Math.round(u * 0.046);
          const pillW = Math.min(cardW * 0.86, Math.round(u * 0.68));
          const pillX = w / 2 - pillW / 2;
          const pillY = cardY - pillH / 2;
          drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 999);
          ctx.fillStyle = '#F5C538';
          ctx.fill();

          const catTitle = (bracketTournament?.name || 'PUTRA').toUpperCase();
          const pillStr = `BAGAN ${catTitle} • ${viewBadgeLabel}`;
          const fittedPill = fitSingleLine(
            ctx,
            pillStr,
            pillW - 28,
            Math.round(pillH * 0.44),
            11,
            '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.fillStyle = '#0B0F19';
          ctx.font = `800 ${fittedPill.fontSize}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fittedPill.text, w / 2, pillY + pillH / 2 + 1);
          ctx.textBaseline = 'alphabetic';

          const mainBrMatches = bracketMatches.filter((m) => m.bracketType === 'main');
          const thirdBrMatch = bracketMatches.find((m) => m.bracketType === 'third_place') ?? null;
          const grandFinalBrMatch =
            mainBrMatches.find((m) => m.round === bracketTotalRounds) ?? null;
          const preFinalRounds = Array.from(
            { length: Math.max(0, bracketTotalRounds - 1) },
            (_, i) => i + 1
          );

          const drawMiniTeamLogo = (
            lx: number,
            ly: number,
            lSize: number,
            teamId: number | null,
            fallbackTxt: string
          ) => {
            const img = teamId ? assets.teamLogos.get(teamId) ?? null : null;
            ctx.save();
            drawRoundedRect(ctx, lx, ly, lSize, lSize, Math.round(lSize * 0.24));
            ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
            ctx.fill();
            if (img && img.width > 0 && img.height > 0) {
              const pImg = Math.max(2, Math.round(lSize * 0.1));
              const maxB = lSize - pImg * 2;
              const sc = Math.min(maxB / img.width, maxB / img.height);
              const dw = img.width * sc;
              const dh = img.height * sc;
              ctx.drawImage(img, lx + (lSize - dw) / 2, ly + (lSize - dh) / 2, dw, dh);
            } else {
              ctx.fillStyle = '#0F172A';
              ctx.font = `800 ${Math.max(8, Math.round(lSize * 0.42))}px "Barlow Condensed", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(fallbackTxt.slice(0, 2).toUpperCase(), lx + lSize / 2, ly + lSize / 2 + 1);
            }
            ctx.restore();
          };

          const drawBracketMatchCard = (
            m: Match | undefined,
            mx: number,
            my: number,
            mw: number,
            mh: number,
            revealP: number,
            isSpotlight = false
          ) => {
            if (revealP <= 0.01) return;
            const slideShift = (1 - easeOutCubic(revealP)) * 18;
            ctx.save();
            ctx.globalAlpha *= easeOutCubic(revealP);
            const ry = my + slideShift;

            drawRoundedRect(ctx, mx, ry, mw, mh, Math.min(14, Math.round(mh * 0.16)));
            const isFin = m?.status === 'finished';
            const isLv = m?.status === 'live';
            ctx.fillStyle = isSpotlight
              ? 'rgba(30, 41, 59, 0.96)'
              : isLv
                ? 'rgba(185, 28, 28, 0.24)'
                : 'rgba(255, 255, 255, 0.07)';
            ctx.fill();
            ctx.lineWidth = isSpotlight ? 2.5 : 1.2;
            ctx.strokeStyle = isSpotlight
              ? 'rgba(245, 197, 56, 0.9)'
              : isLv
                ? 'rgba(248, 113, 113, 0.7)'
                : isFin
                  ? 'rgba(245, 197, 56, 0.48)'
                  : 'rgba(148, 163, 184, 0.28)';
            ctx.stroke();

            if (!m) {
              ctx.fillStyle = '#64748B';
              ctx.font = `700 ${Math.max(10, Math.round(mh * 0.22))}px "Plus Jakarta Sans", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('TBD', mx + mw / 2, ry + mh / 2);
              ctx.restore();
              return;
            }

            const tA = m.teamAId ? teamMap.get(m.teamAId) : undefined;
            const tB = m.teamBId ? teamMap.get(m.teamBId) : undefined;
            const winA = isFin && m.winnerId && m.winnerId === m.teamAId;
            const winB = isFin && m.winnerId && m.winnerId === m.teamBId;
            const isBye = m.status === 'bye';

            const rowH = mh / 2;
            const padX = Math.max(6, Math.round(mw * 0.045));
            const logoS = Math.max(14, Math.min(Math.round(rowH * 0.68), Math.round(mw * 0.16)));
            const scoreW = Math.max(20, Math.round(mw * 0.14));

            // Divider line between Team A & Team B
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(mx + padX, ry + rowH);
            ctx.lineTo(mx + mw - padX, ry + rowH);
            ctx.stroke();

            const drawSlotRow = (
              teamObj: Team | undefined,
              teamId: number | null,
              scoreVal: number,
              isWinner: boolean,
              slotY: number
            ) => {
              const nameStr = teamObj?.name || 'TBD';
              drawMiniTeamLogo(
                mx + padX,
                slotY + (rowH - logoS) / 2,
                logoS,
                teamId,
                nameStr
              );

              const textStart = mx + padX + logoS + Math.max(5, Math.round(padX * 0.8));
              const textMaxW = Math.max(30, mx + mw - padX - scoreW - 6 - textStart);
              const fittedName = fitSingleLine(
                ctx,
                nameStr,
                textMaxW,
                Math.max(10, Math.round(rowH * 0.44)),
                8,
                '700 {SIZE}px "Barlow Condensed", sans-serif'
              );
              ctx.fillStyle = isWinner ? '#FACC15' : teamObj ? '#F8FAFC' : '#64748B';
              ctx.font = `${isWinner ? '800' : '700'} ${fittedName.fontSize}px "Barlow Condensed", sans-serif`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(fittedName.text, textStart, slotY + rowH / 2 + 1);

              // Score box
              const scTxt = isBye ? (teamObj ? 'W' : '-') : (isFin || isLv ? `${scoreVal}` : '-');
              ctx.fillStyle = isWinner ? '#FACC15' : isLv ? '#F87171' : '#94A3B8';
              ctx.font = `800 ${Math.max(10, Math.round(rowH * 0.46))}px "Barlow Condensed", sans-serif`;
              ctx.textAlign = 'right';
              ctx.fillText(scTxt, mx + mw - padX, slotY + rowH / 2 + 1);
            };

            drawSlotRow(tA, m.teamAId, m.setsWonA, Boolean(winA), ry);
            drawSlotRow(tB, m.teamBId, m.setsWonB, Boolean(winB), ry + rowH);
            ctx.restore();
          };

          const drawBracketWing = (
            side: 'left' | 'right',
            wx: number,
            wy: number,
            ww: number,
            wh: number,
            wingP: number
          ) => {
            const cols = side === 'left' ? preFinalRounds : [...preFinalRounds].reverse();
            const numCols = Math.max(1, cols.length);
            const colGap = Math.max(12, Math.round(ww * 0.04));
            const colW = (ww - colGap * (numCols - 1)) / numCols;
            const headerH = Math.round(u * 0.032);
            const bodyTop = wy + headerH;
            const bodyH = Math.max(120, wh - headerH);

            // Compute coordinates for all nodes in this wing
            const nodeCoords = new Map<
              number,
              Array<{ x: number; y: number; w: number; h: number; match?: Match }>
            >();

            cols.forEach((rNum, cIdx) => {
              const allRoundMatches = mainBrMatches
                .filter((m) => m.round === rNum)
                .sort((a, b) => a.matchIndex - b.matchIndex);
              const half = Math.ceil(allRoundMatches.length / 2);
              const wingMatches =
                side === 'left' ? allRoundMatches.slice(0, half) : allRoundMatches.slice(half);
              const count = Math.max(1, wingMatches.length);
              const colX = wx + cIdx * (colW + colGap);

              // Stage Column Header
              const roundLbl = formatInternationalStageLabel(
                { round: rNum, bracketType: 'main' },
                bracketTotalRounds
              ).toUpperCase();
              const fittedColHdr = fitSingleLine(
                ctx,
                roundLbl,
                colW,
                Math.max(10, Math.round(headerH * 0.54)),
                8,
                '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
              );
              ctx.fillStyle = '#FDE68A';
              ctx.font = `800 ${fittedColHdr.fontSize}px "Plus Jakarta Sans", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(fittedColHdr.text, colX + colW / 2, wy + headerH / 2);

              const slotSpan = bodyH / count;
              const boxH = Math.min(Math.round(u * 0.115), Math.max(36, slotSpan * 0.78));

              const list: Array<{ x: number; y: number; w: number; h: number; match?: Match }> = [];
              for (let i = 0; i < count; i++) {
                const boxY = bodyTop + i * slotSpan + (slotSpan - boxH) / 2;
                list.push({ x: colX, y: boxY, w: colW, h: boxH, match: wingMatches[i] });
              }
              nodeCoords.set(rNum, list);
            });

            // Draw Progressive Neon Gold Connector Lines between Rounds
            for (let rIdx = 0; rIdx < preFinalRounds.length - 1; rIdx++) {
              const rFrom = preFinalRounds[rIdx];
              const rTo = preFinalRounds[rIdx + 1];
              const fromList = nodeCoords.get(rFrom) ?? [];
              const toList = nodeCoords.get(rTo) ?? [];
              const connP = clamp01((wingP - rIdx * 0.22) / 0.42);
              if (connP <= 0.01) continue;

              toList.forEach((targetNode, tIdx) => {
                const srcA = fromList[tIdx * 2];
                const srcB = fromList[tIdx * 2 + 1];
                const tCenterY = targetNode.y + targetNode.h / 2;
                const tEdgeX =
                  side === 'left' ? targetNode.x : targetNode.x + targetNode.w;

                [srcA, srcB].forEach((src) => {
                  if (!src) return;
                  const sEdgeX = side === 'left' ? src.x + src.w : src.x;
                  const sCenterY = src.y + src.h / 2;
                  const midX = (sEdgeX + tEdgeX) / 2;
                  const hasWin = Boolean(src.match?.winnerId);

                  ctx.save();
                  ctx.strokeStyle = hasWin
                    ? 'rgba(245, 197, 56, 0.88)'
                    : 'rgba(148, 163, 184, 0.35)';
                  ctx.lineWidth = hasWin ? 2.4 : 1.4;
                  if (hasWin) {
                    ctx.shadowColor = 'rgba(245, 197, 56, 0.5)';
                    ctx.shadowBlur = 8;
                  }
                  ctx.beginPath();
                  ctx.moveTo(sEdgeX, sCenterY);
                  const seg1X = sEdgeX + (midX - sEdgeX) * clamp01(connP * 2.2);
                  ctx.lineTo(seg1X, sCenterY);
                  if (connP > 0.38) {
                    const vP = clamp01((connP - 0.38) / 0.35);
                    ctx.lineTo(midX, sCenterY + (tCenterY - sCenterY) * vP);
                  }
                  if (connP > 0.7) {
                    const hP = clamp01((connP - 0.7) / 0.3);
                    ctx.lineTo(midX + (tEdgeX - midX) * hP, tCenterY);
                  }
                  ctx.stroke();
                  ctx.restore();
                });
              });
            }

            // Draw Match Cards Staggered by Round
            cols.forEach((rNum) => {
              const orderIdx = preFinalRounds.indexOf(rNum);
              const roundP = clamp01((wingP - orderIdx * 0.2) / 0.45);
              const list = nodeCoords.get(rNum) ?? [];
              list.forEach((node) => {
                drawBracketMatchCard(node.match, node.x, node.y, node.w, node.h, roundP);
              });
            });
          };

          const drawBracketFinals = (
            fx: number,
            fy: number,
            fw: number,
            fh: number,
            finP: number
          ) => {
            const p = easeOutCubic(finP);
            const has3rd = bracketTournament?.hasThirdPlace !== false;
            const gfW = Math.min(fw, Math.round(u * 0.72));
            const gfH = Math.round(Math.min(fh * 0.42, u * 0.24));
            const gfX = fx + (fw - gfW) / 2;
            const gfY = fy + (has3rd ? Math.round(fh * 0.14) : Math.round((fh - gfH) / 2));

            // GRAND FINAL Title
            ctx.save();
            ctx.globalAlpha *= p;
            ctx.fillStyle = '#FACC15';
            ctx.font = `800 ${Math.round(u * 0.032)}px "Barlow Condensed", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('🏆 GRAND FINAL', fx + fw / 2, gfY - Math.round(u * 0.018));
            ctx.restore();

            drawBracketMatchCard(
              grandFinalBrMatch ?? undefined,
              gfX,
              gfY,
              gfW,
              gfH,
              p,
              true
            );

            // 3rd Place or Juara 3 Bersama
            const thirdY = gfY + gfH + Math.round(u * 0.075);
            const thirdH = Math.round(Math.min(fh * 0.28, u * 0.165));
            const thirdW = Math.round(gfW * 0.9);
            const thirdX = fx + (fw - thirdW) / 2;

            ctx.save();
            ctx.globalAlpha *= clamp01((finP - 0.25) / 0.55);
            ctx.fillStyle = '#CBD5E1';
            ctx.font = `800 ${Math.round(u * 0.025)}px "Barlow Condensed", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(
              has3rd ? '🥉 PEREBUTAN JUARA 3' : '🥉 JUARA 3 BERSAMA',
              fx + fw / 2,
              thirdY - Math.round(u * 0.014)
            );
            ctx.restore();

            if (has3rd) {
              drawBracketMatchCard(
                thirdBrMatch ?? undefined,
                thirdX,
                thirdY,
                thirdW,
                thirdH,
                clamp01((finP - 0.25) / 0.55),
                false
              );
            } else {
              const brRes = resolveTournamentPodium(
                { id: bracketTournament?.id ?? 1, hasThirdPlace: false },
                bracketMatches,
                data.teams ?? []
              );
              const jointNames =
                brRes.jointThirdTeams.length > 0
                  ? brRes.jointThirdTeams.map((t) => t.name).join('  &  ')
                  : 'Semifinalis Pool A & Pool B';
              ctx.save();
              ctx.globalAlpha *= clamp01((finP - 0.25) / 0.55);
              drawRoundedRect(ctx, thirdX, thirdY, thirdW, thirdH * 0.72, 14);
              ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
              ctx.fill();
              ctx.strokeStyle = 'rgba(245, 197, 56, 0.45)';
              ctx.lineWidth = 1.5;
              ctx.stroke();

              const fittedJoint = fitSingleLine(
                ctx,
                jointNames,
                thirdW - 28,
                Math.round(u * 0.028),
                11,
                '700 {SIZE}px "Barlow Condensed", sans-serif'
              );
              ctx.fillStyle = '#FDE68A';
              ctx.font = `700 ${fittedJoint.fontSize}px "Barlow Condensed", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(fittedJoint.text, fx + fw / 2, thirdY + (thirdH * 0.72) / 2);
              ctx.restore();
            }
          };

          const innerPadX = Math.round(cardW * 0.035);
          const innerTop = cardY + Math.round(u * 0.042);
          const innerBot = cardY + cardH - (caption.trim() ? Math.round(u * 0.048) : Math.round(u * 0.022));
          const innerW = cardW - innerPadX * 2;
          const innerH = Math.max(140, innerBot - innerTop);

          ctx.save();
          ctx.globalAlpha *= actFade;
          if (viewMode === 'left') {
            drawBracketWing('left', cardX + innerPadX, innerTop, innerW, innerH, actProgress);
          } else if (viewMode === 'right') {
            drawBracketWing('right', cardX + innerPadX, innerTop, innerW, innerH, actProgress);
          } else if (viewMode === 'finals') {
            drawBracketFinals(cardX + innerPadX, innerTop, innerW, innerH, actProgress);
          } else {
            // Full overview: 37% Left, 26% Center, 37% Right
            const sideW = Math.round(innerW * 0.37);
            const centerW = Math.round(innerW * 0.24);
            const gapW = Math.round(innerW * 0.01);
            drawBracketWing('left', cardX + innerPadX, innerTop, sideW, innerH, actProgress);
            drawBracketFinals(
              cardX + innerPadX + sideW + gapW,
              innerTop,
              centerW,
              innerH,
              actProgress
            );
            drawBracketWing(
              'right',
              cardX + innerPadX + sideW + gapW * 2 + centerW,
              innerTop,
              sideW,
              innerH,
              actProgress
            );
          }
          ctx.restore();

          if (caption.trim()) {
            const fittedCap = fitSingleLine(
              ctx,
              caption.trim(),
              cardW - 36,
              Math.round(u * 0.022),
              10,
              '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
            );
            ctx.fillStyle = '#FDE68A';
            ctx.font = `700 ${fittedCap.fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(fittedCap.text, w / 2, cardY + cardH - Math.round(u * 0.016));
          }
          ctx.restore();
          return;
        }

        // 1. FRAME POLOS (clean_frame): Foto/video penuh + header logo resmi & optional strip footer tipis
        if (template === 'clean_frame') {
          if (cleanFrameShowFooter) {
            const slideUp = (1 - easeOutQuint(cardT)) * 45;
            const stripH = Math.round(u * 0.052);
            const stripW = isLandscape ? Math.round(w * 0.72) : w - pad * 2;
            const stripX = Math.round((w - stripW) / 2);
            const stripY = h - safeBottom - stripH - Math.round(u * 0.01) + slideUp;

            ctx.save();
            ctx.globalAlpha = easeOutCubic(cardT);
            drawRoundedRect(ctx, stripX, stripY, stripW, stripH, 999);
            ctx.fillStyle = 'rgba(11, 16, 30, 0.84)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(245, 197, 56, 0.7)';
            ctx.stroke();

            const rawLabel =
              caption.trim() ||
              `${data.settings?.eventName || 'SMANSAGE VOLLEYBALL COMPETITION'} • ${data.settings?.eventSubtitle || 'AVERSA 44'}`;
            const fittedStrip = fitSingleLine(
              ctx,
              rawLabel,
              stripW - 36,
              Math.round(stripH * 0.42),
              11,
              '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
            );
            ctx.fillStyle = '#FDE68A';
            ctx.font = `700 ${fittedStrip.fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(fittedStrip.text, w / 2, stripY + stripH / 2 + 1);
            ctx.textBaseline = 'alphabetic';
            ctx.restore();
          }
          return;
        }

        // 2. CEREMONY & BOOTH (event_moment): Lower-third elegan dengan pill + judul + subjudul
        if (template === 'event_moment') {
          const slideY = (1 - easeOutQuint(cardT)) * 90;
          const cardW = isLandscape ? Math.round(w * 0.76) : w - pad * 2;
          const hasNote = Boolean(caption.trim());
          const cardH = Math.round(u * (hasNote ? 0.215 : 0.185));
          const cardX = Math.round((w - cardW) / 2);
          const cardY = h - safeBottom - cardH - Math.round(u * 0.015) + slideY;

          ctx.save();
          ctx.globalAlpha = easeOutCubic(cardT);
          drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 22);
          ctx.fillStyle = 'rgba(11, 16, 30, 0.9)';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.85)';
          ctx.stroke();

          // Accent Gold Pill Header
          const badgeTxt = (eventMomentBadge.trim() || 'MOMEN SPESIAL').toUpperCase();
          const pillH = Math.round(u * 0.04);
          ctx.font = `800 ${Math.round(pillH * 0.48)}px "Plus Jakarta Sans", sans-serif`;
          const pillW = Math.min(
            cardW * 0.82,
            Math.max(Math.round(u * 0.28), Math.round(ctx.measureText(badgeTxt).width + 36))
          );
          const pillX = w / 2 - pillW / 2;
          const pillY = cardY - pillH / 2;
          drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 999);
          ctx.fillStyle = '#F5C538';
          ctx.fill();

          const fittedPill = fitSingleLine(
            ctx,
            badgeTxt,
            pillW - 22,
            Math.round(pillH * 0.48),
            11,
            '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.fillStyle = '#0B0F19';
          ctx.font = `800 ${fittedPill.fontSize}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fittedPill.text, w / 2, pillY + pillH / 2 + 1);

          // Main Title
          const mainTitleTxt = (eventMomentTitle.trim() || 'AVERSA DIES NATALIS KE-44').toUpperCase();
          const fittedTitle = fitSingleLine(
            ctx,
            mainTitleTxt,
            cardW - 44,
            Math.round(u * 0.052),
            16,
            '800 {SIZE}px "Barlow Condensed", sans-serif'
          );
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `800 ${fittedTitle.fontSize}px "Barlow Condensed", sans-serif`;
          ctx.fillText(fittedTitle.text, w / 2, cardY + cardH * (hasNote ? 0.42 : 0.48));

          // Subtitle
          const subTxt = eventMomentSubtitle.trim() || 'SMA Negeri 1 Gedeg • Mojokerto';
          const fittedSub = fitSingleLine(
            ctx,
            subTxt,
            cardW - 44,
            Math.round(u * 0.025),
            11,
            '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.fillStyle = '#CBD5E1';
          ctx.font = `700 ${fittedSub.fontSize}px "Plus Jakarta Sans", sans-serif`;
          ctx.fillText(fittedSub.text, w / 2, cardY + cardH * (hasNote ? 0.67 : 0.76));

          if (hasNote) {
            const fittedNote = fitSingleLine(
              ctx,
              caption.trim(),
              cardW - 44,
              Math.round(u * 0.02),
              10,
              '600 {SIZE}px "Plus Jakarta Sans", sans-serif'
            );
            ctx.fillStyle = '#FDE68A';
            ctx.font = `600 ${fittedNote.fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.fillText(fittedNote.text, w / 2, cardY + cardH * 0.86);
          }

          ctx.textBaseline = 'alphabetic';
          ctx.restore();
          return;
        }


        // 3. TATA TERTIB & LARANGAN (venue_rules): Panel peraturan tegas & mudah dibaca
        if (template === 'venue_rules') {
          const cardTop = safeTop + Math.round(u * (photoCredit.trim() ? 0.165 : 0.13));
          const cardBot = h - safeBottom - Math.round(u * 0.025);
          const cardH = Math.max(260, cardBot - cardTop);
          const cardW = isLandscape ? Math.round(w * 0.84) : w - pad * 2;
          const cardX = Math.round((w - cardW) / 2);
          const slideOffset = (1 - easeOutQuint(cardT)) * 90;
          const cardY = cardTop + slideOffset;

          ctx.save();
          ctx.globalAlpha = easeOutCubic(cardT);
          drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 26);
          ctx.fillStyle = 'rgba(11, 16, 30, 0.93)';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
          ctx.stroke();

          // Red/Gold Alert Pill Header
          const pillH = Math.round(u * 0.048);
          const pillW = Math.min(cardW * 0.86, Math.round(u * 0.68));
          const pillX = w / 2 - pillW / 2;
          const pillY = cardY - pillH / 2;
          drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 999);
          ctx.fillStyle = '#DC2626';
          ctx.fill();

          const rulesHeaderTxt = (venueRulesTitle.trim() || 'TATA TERTIB & LARANGAN ARENA').toUpperCase();
          const fittedHdr = fitSingleLine(
            ctx,
            rulesHeaderTxt,
            pillW - 28,
            Math.round(pillH * 0.44),
            12,
            '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `800 ${fittedHdr.fontSize}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fittedHdr.text, w / 2, pillY + pillH / 2 + 1);
          ctx.textBaseline = 'alphabetic';

          const cleanRules = venueRulesItems.map((r) => r.trim()).filter(Boolean).slice(0, 6);
          const innerPadX = Math.round(cardW * 0.05);
          const headerSpace = Math.round(u * 0.046);
          const footerSpace = caption.trim() ? Math.round(u * 0.052) : Math.round(u * 0.025);
          const listTop = cardY + headerSpace;
          const listAvailH = Math.max(120, cardH - headerSpace - footerSpace);
          const count = Math.max(1, cleanRules.length);
          const rowGap = Math.max(10, Math.round(listAvailH * 0.028));
          const rowH = Math.min(
            Math.round(u * 0.16),
            Math.floor((listAvailH - rowGap * (count - 1)) / count)
          );
          const totalListH = count * rowH + Math.max(0, count - 1) * rowGap;
          const startRowY = listTop + Math.max(0, Math.round((listAvailH - totalListH) / 2));

          cleanRules.forEach((ruleText, idx) => {
            const ry = startRowY + idx * (rowH + rowGap);
            const rx = cardX + innerPadX;
            const rw = cardW - innerPadX * 2;

            drawRoundedRect(ctx, rx, ry, rw, rowH, 14);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
            ctx.fill();
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = 'rgba(248, 113, 113, 0.35)';
            ctx.stroke();

            const numSize = Math.round(Math.min(rowH * 0.56, rw * 0.085));
            const numX = rx + Math.round(rw * 0.03);
            const numY = ry + rowH / 2 - numSize / 2;
            drawRoundedRect(ctx, numX, numY, numSize, numSize, Math.round(numSize * 0.25));
            ctx.fillStyle = '#DC2626';
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.font = `800 ${Math.round(numSize * 0.56)}px "Barlow Condensed", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${idx + 1}`, numX + numSize / 2, ry + rowH / 2 + 1);

            const textLeft = numX + numSize + Math.round(rw * 0.03);
            const textAvailW = Math.max(80, rx + rw - Math.round(rw * 0.03) - textLeft);
            const fontBase = Math.round(Math.min(u * 0.028, rowH * 0.28));
            const fontMin = Math.max(12, Math.round(u * 0.018));
            const block = measureWrappedBlock(
              ctx,
              ruleText,
              textAvailW,
              fontBase,
              fontMin,
              '700 {SIZE}px "Plus Jakarta Sans", sans-serif',
              2
            );
            ctx.fillStyle = '#F8FAFC';
            ctx.font = `700 ${block.fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            const textStartY =
              ry + (rowH - block.totalH) / 2 + Math.round(block.fontSize * 0.85);
            block.lines.forEach((ln, li) => {
              ctx.fillText(ln, textLeft, textStartY + li * block.lineH);
            });
          });

          if (caption.trim()) {
            const fittedCap = fitSingleLine(
              ctx,
              caption.trim(),
              cardW - 36,
              Math.round(u * 0.022),
              11,
              '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
            );
            ctx.fillStyle = '#FDE68A';
            ctx.font = `700 ${fittedCap.fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(fittedCap.text, w / 2, cardY + cardH - Math.round(u * 0.018));
          }
          ctx.restore();
          return;
        }


        // 4. PENGUMUMAN / INFO CEPAT (announcement): Kartu pengumuman terpusat dengan headline + isi
        if (template === 'announcement') {
          const slideY = (1 - easeOutQuint(cardT)) * 95;
          const cardW = isLandscape ? Math.round(w * 0.78) : w - pad * 2;
          const bodyStr = announcementBody.trim() || 'Informasi resmi panitia pelaksana.';
          const bodyMaxW = cardW - 56;
          const bodyBlock = measureWrappedBlock(
            ctx,
            bodyStr,
            bodyMaxW,
            Math.round(u * 0.028),
            13,
            '600 {SIZE}px "Plus Jakarta Sans", sans-serif',
            4
          );
          const cardH = Math.max(
            Math.round(u * 0.24),
            Math.round(u * 0.165) + bodyBlock.totalH + (caption.trim() ? Math.round(u * 0.04) : 0)
          );
          const cardX = Math.round((w - cardW) / 2);
          const cardY = isLandscape
            ? h - safeBottom - cardH - Math.round(u * 0.015) + slideY
            : Math.round((h - cardH) / 2) + Math.round(u * 0.04) + slideY;

          ctx.save();
          ctx.globalAlpha = easeOutCubic(cardT);
          drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 24);
          ctx.fillStyle = 'rgba(11, 16, 30, 0.92)';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
          ctx.stroke();

          const pillTxt = (announcementBadge.trim() || 'PENGUMUMAN').toUpperCase();
          const pillH = Math.round(u * 0.044);
          ctx.font = `800 ${Math.round(pillH * 0.46)}px "Plus Jakarta Sans", sans-serif`;
          const pillW = Math.min(
            cardW * 0.82,
            Math.max(Math.round(u * 0.3), Math.round(ctx.measureText(pillTxt).width + 38))
          );
          const pillX = w / 2 - pillW / 2;
          const pillY = cardY - pillH / 2;
          drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 999);
          ctx.fillStyle = '#0284C7';
          ctx.fill();

          const fittedPill = fitSingleLine(
            ctx,
            pillTxt,
            pillW - 24,
            Math.round(pillH * 0.46),
            11,
            '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `800 ${fittedPill.fontSize}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fittedPill.text, w / 2, pillY + pillH / 2 + 1);

          const titleTxt = (announcementTitle.trim() || 'INFO PENONTON & ARENA').toUpperCase();
          const fittedTitle = fitSingleLine(
            ctx,
            titleTxt,
            cardW - 48,
            Math.round(u * 0.048),
            16,
            '800 {SIZE}px "Barlow Condensed", sans-serif'
          );
          ctx.fillStyle = '#FACC15';
          ctx.font = `800 ${fittedTitle.fontSize}px "Barlow Condensed", sans-serif`;
          const titleY = cardY + Math.round(u * 0.068);
          ctx.fillText(fittedTitle.text, w / 2, titleY);

          ctx.fillStyle = '#F8FAFC';
          ctx.font = `600 ${bodyBlock.fontSize}px "Plus Jakarta Sans", sans-serif`;
          ctx.textBaseline = 'alphabetic';
          const bodyStartY = titleY + Math.round(u * 0.045);
          bodyBlock.lines.forEach((ln, li) => {
            ctx.fillText(ln, w / 2, bodyStartY + li * bodyBlock.lineH);
          });

          if (caption.trim()) {
            const fittedCap = fitSingleLine(
              ctx,
              caption.trim(),
              cardW - 44,
              Math.round(u * 0.02),
              10,
              '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
            );
            ctx.fillStyle = '#94A3B8';
            ctx.font = `700 ${fittedCap.fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.fillText(fittedCap.text, w / 2, cardY + cardH - Math.round(u * 0.018));
          }

          ctx.restore();
          return;
        }


        const slideY = (1 - easeOutQuint(cardT)) * 120;
        const floatY = animSlide ? Math.sin(globalT * 2.1) * 4 : 0;
        const boxW = isLandscape ? Math.round(w * 0.71) : w - pad * 2;
        const boxH = Math.round(
          u *
            (template === 'highlight'
              ? isStory
                ? 0.28
                : 0.255
              : template === 'champion' && podiumVariant === 'podium_all'
                ? isStory
                  ? 0.36
                  : isPost45
                    ? 0.33
                    : 0.31
                : isStory
                  ? 0.32
                  : isPost45
                    ? 0.29
                    : isSquare
                      ? 0.275
                      : 0.265)
        );
        const boxX = Math.round((w - boxW) / 2);
        const boxY = h - safeBottom - boxH + slideY + floatY;

        const borderColor =
          template === 'champion'
            ? podiumVariant === 'runner_up'
              ? 'rgba(226, 232, 240, 0.88)'
              : podiumVariant === 'third_place'
                ? 'rgba(251, 146, 60, 0.88)'
                : 'rgba(250, 204, 21, 0.92)'
            : stageMeta.isHighStakes
              ? stageMeta.accentHex
              : 'rgba(245, 197, 56, 0.78)';

        ctx.save();
        ctx.globalAlpha = easeOutCubic(cardT);
        drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 26);
        ctx.fillStyle = 'rgba(11, 16, 30, 0.95)';
        ctx.fill();
        ctx.lineWidth = template === 'champion' || effectiveStageKey === 'final' ? 4 : 3;
        ctx.strokeStyle = borderColor;
        ctx.stroke();

        // Subtle inner prestige border for Grand Final & Champion templates
        if (template === 'champion' || effectiveStageKey === 'final') {
          drawRoundedRect(ctx, boxX + 7, boxY + 7, boxW - 14, boxH - 14, 20);
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.32)';
          ctx.stroke();
        }

        // Top Pill Badge (Stage-aware & International Broadcast Standard)
        const stageShort =
          effectiveStageKey === 'final'
            ? 'GRAND FINAL'
            : effectiveStageKey === 'sf'
              ? 'SEMI-FINAL'
              : effectiveStageKey === 'third'
                ? '3RD PLACE'
                : effectiveStageKey === 'qf'
                  ? 'QUARTER-FINAL'
                  : effectiveStageKey === 'pool'
                    ? stageDisplayBadge
                    : 'ROUND OF 16';

        const badgeText =
          template === 'champion'
            ? podiumVariant === 'champion_1'
              ? 'CHAMPIONS • 1ST PLACE'
              : podiumVariant === 'runner_up'
                ? 'RUNNER-UP • 2ND PLACE'
                : podiumVariant === 'third_place'
                  ? '3RD PLACE WINNER'
                  : 'OFFICIAL PODIUM'
            : template === 'live'
              ? `${stageShort} • LIVE S${activeMatch?.currentSet ?? 1}`
              : template === 'final'
                ? `${stageShort} • FINAL SCORE`
                : template === 'upcoming'
                  ? `${stageShort} • UPCOMING`
                  : `${stageShort} • HIGHLIGHT`;

        const badgeH = Math.round(boxH * 0.19);
        const badgeW = Math.round(Math.min(boxW * 0.74, u * 0.58));
        const badgeX = boxX + (boxW - badgeW) / 2;
        const badgeY = boxY - badgeH / 2;

        // Multi-Photo Slide Progress Dots right above the Scoreboard Pill
        if (activeSlideIndicator) {
          const dotGap = 10;
          const dotH = 6;
          const activeW = 26;
          const idleW = 9;
          const totalDotsW =
            activeW +
            (activeSlideIndicator.total - 1) * idleW +
            (activeSlideIndicator.total - 1) * dotGap;
          let dx = w / 2 - totalDotsW / 2;
          const dy = badgeY - 18;
          for (let i = 0; i < activeSlideIndicator.total; i++) {
            const isCur = i === activeSlideIndicator.current;
            const dw = isCur ? activeW : idleW;
            drawRoundedRect(ctx, dx, dy, dw, dotH, 999);
            ctx.fillStyle = isCur ? '#F5C538' : 'rgba(255, 255, 255, 0.42)';
            ctx.fill();
            dx += dw + dotGap;
          }
        }

        const pillBg =
          template === 'champion'
            ? podiumVariant === 'runner_up'
              ? '#E2E8F0'
              : podiumVariant === 'third_place'
                ? '#FB923C'
                : '#FACC15'
            : template === 'live'
              ? '#DC2626'
              : template === 'upcoming'
                ? effectiveStageKey === 'final'
                  ? '#D97706'
                  : effectiveStageKey === 'sf'
                    ? '#E11D48'
                    : '#0284C7'
                : stageMeta.accentHex;

        const pillTextDark =
          template === 'champion' ||
          (template !== 'live' && template !== 'upcoming');

        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 999);
        ctx.fillStyle = pillBg;
        ctx.fill();

        if (template === 'champion' || effectiveStageKey === 'final') {
          drawVectorCrown(
            ctx,
            badgeX + Math.round(badgeH * 0.62),
            badgeY + badgeH * 0.46,
            Math.round(badgeH * 0.56),
            pillTextDark ? '#0B0F19' : '#FACC15'
          );
        } else {
          const bIconSize = Math.round(badgeH * 0.78);
          drawBall3D(
            badgeX + Math.round(badgeH * 0.56),
            badgeY + badgeH / 2,
            bIconSize,
            globalT * 1.9 + 0.4,
            globalT * 2.4 + 0.8,
            globalT * 0.7,
            { alpha: easeOutCubic(cardT) }
          );
        }

        ctx.fillStyle = pillTextDark ? '#0B0F19' : '#FFFFFF';
        const fittedPillLabel = fitSingleLine(
          ctx,
          badgeText,
          badgeW - badgeH * 1.45,
          Math.round(badgeH * 0.43),
          Math.round(badgeH * 0.3),
          '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
        );
        ctx.font = `800 ${fittedPillLabel.fontSize}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(
          fittedPillLabel.text,
          w / 2 + Math.round(badgeH * 0.24),
          badgeY + badgeH * 0.66
        );

        // ================================================================
        // CHAMPION / PODIUM DEDICATED CARD BODY
        // ================================================================
    if (template === 'champion') {
          if (podiumVariant === 'podium_all') {
            const rows: Array<{
              rank: string;
              team: Team | null;
              logo: HTMLImageElement | null;
              badgeHex: string;
              textHex: string;
            }> = [
              {
                rank: '1ST',
                team: resolvedPodium1,
                logo: assets.podium1Logo,
                badgeHex: '#FACC15',
                textHex: '#FEF08A',
              },
              {
                rank: '2ND',
                team: resolvedPodium2,
                logo: assets.podium2Logo,
                badgeHex: '#E2E8F0',
                textHex: '#F1F5F9',
              },
              {
                rank: '3RD',
                team: resolvedPodium3,
                logo: assets.podium3Logo,
                badgeHex: '#FB923C',
                textHex: '#FED7AA',
              },
            ];

            const innerTop = boxY + Math.round(boxH * 0.16);
            const innerAvail = Math.round(boxH * 0.68);
            const rowGap = Math.round(boxH * 0.032);
            const rowH = Math.round((innerAvail - rowGap * 2) / 3);

            rows.forEach((r, rIdx) => {
              const ry = innerTop + rIdx * (rowH + rowGap);
              const rx = boxX + 20;
              const rw = boxW - 40;

              drawRoundedRect(ctx, rx, ry, rw, rowH, 14);
              ctx.fillStyle =
                rIdx === 0
                  ? 'rgba(250, 204, 21, 0.14)'
                  : 'rgba(30, 41, 59, 0.65)';
              ctx.fill();
              ctx.lineWidth = 1.4;
              ctx.strokeStyle =
                rIdx === 0 ? 'rgba(250, 204, 21, 0.55)' : 'rgba(148, 163, 184, 0.25)';
              ctx.stroke();

              // Rank pill
              const rkW = Math.round(rowH * 1.38);
              drawRoundedRect(ctx, rx + 8, ry + 6, rkW, rowH - 12, 10);
              ctx.fillStyle = r.badgeHex;
              ctx.fill();
              ctx.fillStyle = '#0B0F19';
              ctx.font = `800 ${Math.round((rowH - 12) * 0.52)}px "Barlow Condensed", sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillText(r.rank, rx + 8 + rkW / 2, ry + rowH * 0.65);

              let textStartX = rx + rkW + 20;
              if (r.logo) {
                const lgS = Math.round(rowH * 0.76);
                drawContainedCanvasImage(
                  ctx,
                  r.logo,
                  textStartX + lgS / 2,
                  ry + rowH / 2,
                  lgS,
                  lgS
                );
                textStartX += lgS + 16;
              }

              const tLabel = r.team
                ? r.team.school
                  ? `${r.team.name} • ${r.team.school}`
                  : r.team.name
                : 'TBD';
              const fittedRow = fitSingleLine(
                ctx,
                tLabel.toUpperCase(),
                rw - (textStartX - rx) - 18,
                Math.round(rowH * 0.48),
                Math.round(rowH * 0.3),
                '800 {SIZE}px "Barlow Condensed", sans-serif'
              );
              ctx.textAlign = 'left';
              ctx.fillStyle = rIdx === 0 ? '#FEF08A' : '#FFFFFF';
              ctx.font = `800 ${fittedRow.fontSize}px "Barlow Condensed", sans-serif`;
              ctx.fillText(fittedRow.text, textStartX, ry + rowH * 0.66);
            });
          } else {
            // Single Spotlight Winner Card (1st Champion, 2nd Runner-Up, or 3rd Place)
            const spotTeam =
              podiumVariant === 'runner_up'
                ? resolvedPodium2
                : podiumVariant === 'third_place'
                  ? resolvedPodium3
                  : resolvedPodium1;
            const spotLogo =
              podiumVariant === 'runner_up'
                ? assets.podium2Logo
                : podiumVariant === 'third_place'
                  ? assets.podium3Logo
                  : assets.podium1Logo;
            const shineBase =
              podiumVariant === 'runner_up'
                ? '#E2E8F0'
                : podiumVariant === 'third_place'
                  ? '#FDBA74'
                  : '#FACC15';

            const midY = boxY + Math.round(boxH * 0.47);
            const crestSize = Math.round(boxH * 0.52);
            const splicedSpot = splitTeamRegionName(
              spotTeam?.name || 'CHAMPION TEAM',
              spotTeam?.school
            );

            const maxAllowedNameW = spotLogo
              ? boxW - (crestSize + 64)
              : boxW - 56;

            const fittedChamp = fitSingleLine(
              ctx,
              splicedSpot.primary.toUpperCase(),
              maxAllowedNameW,
              Math.round(boxH * 0.26),
              Math.round(boxH * 0.13),
              '800 {SIZE}px "Barlow Condensed", sans-serif'
            );
            const fittedReg = splicedSpot.region
              ? fitSingleLine(
                  ctx,
                  splicedSpot.region.toUpperCase(),
                  maxAllowedNameW,
                  Math.round(boxH * 0.11),
                  Math.round(boxH * 0.072),
                  '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
                )
              : null;

            ctx.font = `800 ${fittedChamp.fontSize}px "Barlow Condensed", sans-serif`;
            const champW = ctx.measureText(fittedChamp.text).width;
            let regW = 0;
            if (fittedReg) {
              ctx.font = `700 ${fittedReg.fontSize}px "Plus Jakarta Sans", sans-serif`;
              regW = ctx.measureText(fittedReg.text).width;
            }
            const textBlockW = Math.max(champW, regW);

            let nameCenterX = w / 2;
            if (spotLogo) {
              const lockupGap = Math.round(boxH * 0.11);
              const crestPad = 16;
              const totalLockupW = Math.min(
                boxW - 44,
                crestSize + crestPad + lockupGap + textBlockW
              );
              const lockupLeft = Math.round(w / 2 - totalLockupW / 2);
              const crestBoxCenterX = lockupLeft + (crestSize + crestPad) / 2;

              drawRoundedRect(
                ctx,
                crestBoxCenterX - (crestSize + crestPad) / 2,
                midY - (crestSize + crestPad) / 2,
                crestSize + crestPad,
                crestSize + crestPad,
                18
              );
              ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
              ctx.fill();
              ctx.lineWidth = 1.4;
              ctx.strokeStyle = 'rgba(250, 204, 21, 0.28)';
              ctx.stroke();

              drawContainedCanvasImage(
                ctx,
                spotLogo,
                crestBoxCenterX,
                midY,
                crestSize,
                crestSize
              );

              nameCenterX =
                lockupLeft + crestSize + crestPad + lockupGap + textBlockW / 2;
            }

            ctx.textAlign = 'center';
            ctx.font = `800 ${fittedChamp.fontSize}px "Barlow Condensed", sans-serif`;
            fillShinyText(
              ctx,
              fittedChamp.text,
              nameCenterX,
              splicedSpot.region
                ? midY - Math.round(boxH * 0.015)
                : midY + Math.round(fittedChamp.fontSize * 0.34),
              animSlide ? globalT * 0.45 : 0.45,
              shineBase,
              '#FFFFFF'
            );

            if (fittedReg) {
              ctx.fillStyle = '#CBD5E1';
              ctx.font = `700 ${fittedReg.fontSize}px "Plus Jakarta Sans", sans-serif`;
              ctx.fillText(
                fittedReg.text,
                nameCenterX,
                midY + Math.round(boxH * 0.135)
              );
            }
          }

          const champFooter = (
            caption.trim() ||
            `${tournament?.name || 'OPEN CATEGORY'} • ${data.settings?.eventName || 'OFFICIAL CHAMPIONSHIP'}`
          ).toUpperCase();
          const fittedCF = fitSingleLine(
            ctx,
            champFooter,
            boxW - 48,
            Math.round(boxH * 0.082),
            Math.round(boxH * 0.058),
            '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FDE68A';
          ctx.font = `700 ${fittedCF.fontSize}px "Plus Jakarta Sans", sans-serif`;
          ctx.fillText(fittedCF.text, w / 2, boxY + Math.round(boxH * 0.905));
          ctx.restore();
          return;
        }



        // Center Score inside [boxY + 0.18*boxH .. boxY + 0.72*boxH]
        const countEase = animSlide ? easeOutQuint(clamp01((uiProgress - 0.18) / 0.82)) : 1;
        const dispA = Math.round(scoreA * countEase);
        const dispB = Math.round(scoreB * countEase);
        const scoreStr = template === 'upcoming' ? 'VS' : `${dispA} : ${dispB}`;
        const scoreFont = Math.round(boxH * 0.365);
        const midBandY = boxY + Math.round(boxH * 0.455);
        ctx.font = `800 ${scoreFont}px "Barlow Condensed", sans-serif`;
        const scoreBlockW = ctx.measureText(scoreStr).width + Math.round(boxW * 0.052);

        fillShinyText(
          ctx,
          scoreStr,
          w / 2,
          midBandY + Math.round(scoreFont * 0.34),
          animSlide ? globalT * 0.45 : 0.5,
          '#F5C538',
          '#FFFBEB'
        );

        // Proportional School Crests (~2x larger!) & Readable Team Typography
        const splicedA = splitTeamRegionName(teamA?.name || 'TIM A', teamA?.school);
        const splicedB = splitTeamRegionName(teamB?.name || 'TIM B', teamB?.school);

        const tLogoSize = Math.round(boxH * (isLandscape ? 0.41 : 0.37));
        const logoPad = 12;
        const logoBoxS = tLogoSize + logoPad;
        const logoInsetX = Math.max(20, Math.round(boxW * 0.032));
        const sideTotalW = (boxW - scoreBlockW) / 2;
        const leftOuterPad = assets.teamALogo
          ? logoInsetX + logoBoxS + Math.round(boxW * 0.018)
          : 24;
        const rightOuterPad = assets.teamBLogo
          ? logoInsetX + logoBoxS + Math.round(boxW * 0.018)
          : 24;
        const leftAvailW = Math.max(108, sideTotalW - leftOuterPad - 10);
        const rightAvailW = Math.max(108, sideTotalW - rightOuterPad - 10);
        const leftColCenter = boxX + leftOuterPad + leftAvailW / 2;
        const rightColCenter = boxX + boxW - rightOuterPad - rightAvailW / 2;

        const drawCardTeam = (
          spliced: { primary: string; region: string },
          cx: number,
          maxColW: number
        ) => {
          const hasRegion = Boolean(spliced.region);
          const baseNameSize = Math.round(boxH * 0.215);
          const minSingleSize = Math.round(boxH * 0.135);

          ctx.font = `800 ${minSingleSize}px "Barlow Condensed", sans-serif`;
          const fitsOneLineWell =
            ctx.measureText(spliced.primary).width <= maxColW;

          if (fitsOneLineWell) {
            const fittedP = fitSingleLine(
              ctx,
              spliced.primary,
              maxColW,
              baseNameSize,
              minSingleSize,
              '800 {SIZE}px "Barlow Condensed", sans-serif'
            );
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.font = `800 ${fittedP.fontSize}px "Barlow Condensed", sans-serif`;
            ctx.fillText(
              fittedP.text,
              cx,
              hasRegion
                ? midBandY - Math.round(boxH * 0.01)
                : midBandY + Math.round(fittedP.fontSize * 0.34)
            );
          } else {
            const wrapped = wrapAndFitLines(
              ctx,
              spliced.primary,
              maxColW,
              Math.round(boxH * 0.165),
              Math.round(boxH * 0.108),
              '800 {SIZE}px "Barlow Condensed", sans-serif',
              2
            );
            const lineStep = Math.round(wrapped.fontSize * 1.02);
            const blockH =
              wrapped.lines.length * lineStep -
              (lineStep - wrapped.fontSize);
            const startBaseY = hasRegion
              ? midBandY -
                Math.round(boxH * 0.055) -
                Math.round((blockH - wrapped.fontSize) / 2)
              : midBandY +
                Math.round(wrapped.fontSize * 0.32) -
                Math.round(((wrapped.lines.length - 1) * lineStep) / 2);

            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.font = `800 ${wrapped.fontSize}px "Barlow Condensed", sans-serif`;
            wrapped.lines.forEach((ln, idx) => {
              ctx.fillText(ln, cx, startBaseY + idx * lineStep);
            });
          }

          if (hasRegion) {
            const fittedR = fitSingleLine(
              ctx,
              spliced.region,
              maxColW,
              Math.round(boxH * 0.105),
              Math.round(boxH * 0.068),
              '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
            );
            ctx.fillStyle = '#FDE68A';
            ctx.textAlign = 'center';
            ctx.font = `700 ${fittedR.fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.fillText(
              fittedR.text,
              cx,
              midBandY + Math.round(boxH * 0.128)
            );
          }
        };

        drawCardTeam(splicedA, leftColCenter, leftAvailW);
        drawCardTeam(splicedB, rightColCenter, rightAvailW);

        if (assets.teamALogo) {
          const lx = boxX + logoInsetX + logoBoxS / 2;
          drawRoundedRect(
            ctx,
            lx - logoBoxS / 2,
            midBandY - logoBoxS / 2,
            logoBoxS,
            logoBoxS,
            16
          );
          ctx.fillStyle = 'rgba(255, 255, 255, 0.065)';
          ctx.fill();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.24)';
          ctx.stroke();
          drawContainedCanvasImage(
            ctx,
            assets.teamALogo,
            lx,
            midBandY,
            tLogoSize,
            tLogoSize
          );
        }
        if (assets.teamBLogo) {
          const rx = boxX + boxW - logoInsetX - logoBoxS / 2;
          drawRoundedRect(
            ctx,
            rx - logoBoxS / 2,
            midBandY - logoBoxS / 2,
            logoBoxS,
            logoBoxS,
            16
          );
          ctx.fillStyle = 'rgba(255, 255, 255, 0.065)';
          ctx.fill();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.24)';
          ctx.stroke();
          drawContainedCanvasImage(
            ctx,
            assets.teamBLogo,
            rx,
            midBandY,
            tLogoSize,
            tLogoSize
          );
        }

        const playedSets =
          activeMatch?.sets.filter((s) => s.scoreA > 0 || s.scoreB > 0) ?? [];
        const setSummary = playedSets.length
          ? playedSets.map((s) => `${s.scoreA}-${s.scoreB}`).join('  |  ')
          : '';

        if (template === 'upcoming') {
          const schedLine = caption.trim()
            ? `${upcomingScheduleAndCourt.toUpperCase()}  •  ${caption.trim()}`
            : `${resolvedScheduleLabel.toUpperCase()}  •  ${resolvedCourtLabel.toUpperCase()}`;
          const pillMaxW = boxW - 44;
          const fittedSched = fitSingleLine(
            ctx,
            schedLine,
            pillMaxW - 36,
            Math.round(boxH * 0.1),
            Math.round(boxH * 0.065),
            '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.font = `800 ${fittedSched.fontSize}px "Plus Jakarta Sans", sans-serif`;
          const schedTextW = ctx.measureText(fittedSched.text).width;
          const schedPillH = Math.round(boxH * 0.168);
          const schedPillW = Math.min(pillMaxW, Math.round(schedTextW + 38));
          const schedPillX = Math.round(w / 2 - schedPillW / 2);
          const schedPillY = boxY + Math.round(boxH * 0.768);

          drawRoundedRect(ctx, schedPillX, schedPillY, schedPillW, schedPillH, 999);
          ctx.fillStyle = 'rgba(2, 132, 199, 0.24)';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.55)';
          ctx.stroke();

          ctx.fillStyle = '#FDE68A';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fittedSched.text, w / 2, schedPillY + schedPillH / 2 + 1);
          ctx.textBaseline = 'alphabetic';
        } else {
          const fallbackMatchMeta = `${tournament?.name || 'SVC'}  •  ${activeMatch?.courtName || 'Official Match'}`;
          const footerLine =
            caption.trim() || setSummary || fallbackMatchMeta;
          const fittedFooter = fitSingleLine(
            ctx,
            footerLine,
            boxW - 48,
            Math.round(boxH * 0.1),
            Math.round(boxH * 0.068),
            '600 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.fillStyle = '#E2E8F0';
          ctx.textAlign = 'center';
          ctx.font = `600 ${fittedFooter.fontSize}px "Plus Jakarta Sans", sans-serif`;
          ctx.fillText(fittedFooter.text, w / 2, boxY + Math.round(boxH * 0.885));
        }
        ctx.restore();
      };

      if (!isVideo) {
        drawPhotoAndScoreboard(1, 1, false, 0.35);
        drawSafeZoneOverlay();
        return;
      }

      // ================================================================
      // ADAPTIVE ZERO-HARD-CUT OVERLAPPING BROADCAST COMPOSITOR
      // ================================================================
      const t = Math.max(0, Math.min(timeline.totalDurationSec, timeSec));
      const statusHeadline =
        template === 'champion'
          ? podiumVariant === 'runner_up'
            ? '2ND PLACE • RUNNER-UP'
            : podiumVariant === 'third_place'
              ? '3RD PLACE WINNER'
              : podiumVariant === 'podium_all'
                ? 'OFFICIAL PODIUM'
                : 'CHAMPIONS'
          : template === 'schedule_day'
            ? `JADWAL • ${activeScheduleDay?.dayLabel?.toUpperCase() || 'PERTANDINGAN'}`
            : template === 'bracket'
              ? `BAGAN ${(bracketTournament?.name || 'TURNAMEN').toUpperCase()}`
              : template === 'clean_frame'
              ? (data.settings?.eventName || 'AVERSA 44 • SMANSAGE').toUpperCase()
              : template === 'event_moment'
                ? (eventMomentBadge.trim() || 'MOMEN SPESIAL').toUpperCase()
                : template === 'venue_rules'
                  ? (venueRulesTitle.trim() || 'TATA TERTIB ARENA').toUpperCase()
                  : template === 'announcement'
                    ? (announcementBadge.trim() || 'PENGUMUMAN').toUpperCase()
                    : template === 'final'
                      ? `${stageDisplayBadge} • FINAL`
                      : template === 'upcoming'
                        ? `${stageDisplayBadge} • UPCOMING`
                        : `${stageDisplayBadge} • LIVE`;

      // ----------------------------------------------------------------
      // LAYER HELPER A: Scene 1 (SVC Poster Intro — 16:9 2-Column & Sequential Y-Flow)
      // ----------------------------------------------------------------
      const drawScene1Intro = (time: number) => {
        const p = clamp01(time / 3.2);

        const bgGrad = ctx.createLinearGradient(0, 0, w, h);
        bgGrad.addColorStop(0, '#FFFDF2');
        bgGrad.addColorStop(0.42, '#F9DC76');
        bgGrad.addColorStop(1, '#EBBF4B');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        drawAuroraAndBokeh(ctx, w, h, time, 0.7, 'gold');

        // Back Parallax (0.25x): Official Perspective Volleyball Net
        if (assets.netOfficial) {
          const netW = Math.round(u * 0.56);
          const netH = Math.round(netW * (415 / 385));
          ctx.save();
          ctx.globalAlpha = 0.52;
          ctx.drawImage(assets.netOfficial, -p * 18, -p * 12, netW, netH);
          ctx.restore();
        }

        // Warm sunlit stadium flare
        const sunGrad = ctx.createRadialGradient(
          w * 0.08,
          h * 0.05,
          u * 0.01,
          w * 0.08,
          h * 0.05,
          u * 0.5
        );
        sunGrad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
        sunGrad.addColorStop(0.4, 'rgba(255, 253, 240, 0.35)');
        sunGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = sunGrad;
        ctx.fillRect(0, 0, w, h);

        // Mid Parallax (0.55x): Official Jumping Spiker Silhouette
        if (assets.spikerOfficial) {
          const silW = Math.round(u * 0.44);
          const silH = Math.round(silW * (395 / 268));
          const jumpLift = easeOutCubic(clamp01(p / 0.6)) * 28;
          const silX = isLandscape ? w * 0.76 - p * 20 : w * 0.62 - p * 20;
          const silY = (isStory ? safeTop + h * 0.05 : h * 0.14) - jumpLift;
          ctx.save();
          ctx.globalAlpha = isLandscape ? 0.38 : 0.54;
          ctx.drawImage(assets.spikerOfficial, silX, silY, silW, silH);
          ctx.restore();
        }

        // Crisp Sporty White Diagonal Court Floor Wedge
        ctx.save();
        ctx.globalAlpha = 0.94;
        const floorShift = (1 - easeOutQuint(clamp01(p / 0.38))) * 60;
        const wedgeSideY = isStory ? h * 0.67 : isLandscape ? h * 0.74 : h * 0.69;
        const wedgeTipY = isStory ? h * 0.79 : isLandscape ? h * 0.88 : h * 0.83;
        ctx.fillStyle = '#FAFBFD';
        ctx.beginPath();
        ctx.moveTo(0, wedgeSideY + floorShift);
        ctx.lineTo(w * 0.5, wedgeTipY + floorShift);
        ctx.lineTo(w, wedgeSideY + floorShift);
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(212, 137, 17, 0.48)';
        ctx.lineWidth = Math.max(3, u * 0.004);
        ctx.beginPath();
        ctx.moveTo(0, wedgeSideY + floorShift);
        ctx.lineTo(w * 0.5, wedgeTipY + floorShift);
        ctx.lineTo(w, wedgeSideY + floorShift);
        ctx.stroke();
        ctx.restore();

        if (assets.mainLogo) {
          const wmSize = Math.round(u * 0.56);
          ctx.save();
          ctx.globalAlpha = 0.09;
          ctx.drawImage(assets.mainLogo, (w - wmSize) / 2, wedgeSideY - u * 0.04 + p * 10, wmSize, wmSize);
          ctx.restore();
        }

        // Reusable 3-Logo Pill helper centered at (pillCenterX, pillTopY)
        const drawThreeLogoPill = (pillCenterX: number, pillTopY: number, pillH: number) => {
          const logoGap = Math.round(u * 0.032);
          const pillPadX = Math.round(u * 0.042);
          const pillItems: Array<{ img: HTMLImageElement; dw: number; dh: number }> = [];
          if (assets.organizerLogo) {
            const dh = Math.round(pillH * 0.72);
            const dw = Math.round(
              dh * (assets.organizerLogo.width / Math.max(1, assets.organizerLogo.height))
            );
            pillItems.push({ img: assets.organizerLogo, dw, dh });
          }
          if (assets.mainLogo) {
            const dh = Math.round(pillH * 0.74);
            const dw = Math.round(
              dh * (assets.mainLogo.width / Math.max(1, assets.mainLogo.height))
            );
            pillItems.push({ img: assets.mainLogo, dw, dh });
          }
          if (assets.coLogo) {
            const dh = Math.round(pillH * 0.56);
            const dw = Math.round(
              dh * (assets.coLogo.width / Math.max(1, assets.coLogo.height))
            );
            pillItems.push({ img: assets.coLogo, dw, dh });
          }
          if (pillItems.length === 0) return;

          const contentW =
            pillItems.reduce((acc, it) => acc + it.dw, 0) +
            logoGap * Math.max(0, pillItems.length - 1);
          const pillW = Math.max(Math.round(u * 0.48), contentW + pillPadX * 2);
          const pillX = pillCenterX - pillW / 2;

          ctx.save();
          ctx.globalAlpha = easeOutCubic(clamp01(time / 0.55));
          ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
          ctx.shadowBlur = 20;
          ctx.shadowOffsetY = 6;
          drawRoundedRect(ctx, pillX, pillTopY, pillW, pillH, 999);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
          ctx.lineWidth = Math.max(2, u * 0.0022);
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.58)';
          ctx.stroke();

          let curX = pillCenterX - contentW / 2;
          pillItems.forEach((it, idx) => {
            const iy = pillTopY + (pillH - it.dh) / 2;
            ctx.drawImage(it.img, curX, iy, it.dw, it.dh);
            curX += it.dw;
            if (idx < pillItems.length - 1) {
              const divX = curX + logoGap / 2;
              ctx.strokeStyle = 'rgba(245, 197, 56, 0.35)';
              ctx.lineWidth = Math.max(1.5, u * 0.0018);
              ctx.beginPath();
              ctx.moveTo(divX, pillTopY + pillH * 0.26);
              ctx.lineTo(divX, pillTopY + pillH * 0.74);
              ctx.stroke();
              curX += logoGap;
            }
          });
          ctx.restore();
        };

        const scale = easeOutBack(clamp01(time / 0.95));
        const floatY = Math.sin(time * 2.1) * 6 - p * 8;
        const ballEnter = easeOutCubic(clamp01(time / 0.75));
        const vbArc = Math.sin(clamp01(time / 2.9) * Math.PI) * (u * 0.035);
        const splitP = clamp01((time - 0.35) / 0.95);
        const subP = easeOutCubic(clamp01((time - 0.65) / 0.65));
        const officialTagLabel =
          template === 'champion'
            ? 'OFFICIAL CHAMPIONSHIP CEREMONY'
            : template === 'final'
              ? `${stageDisplayBadge} • FINAL RESULT`
              : template === 'upcoming'
                ? `${stageDisplayBadge} • MATCH SCHEDULE`
                : `${stageDisplayBadge} • LIVE BROADCAST`;

        if (isLandscape) {
          // ============================================================
          // 16:9 LANDSCAPE 2-COLUMN BROADCAST OPENER (0% Overlap)
          // Left Column: Panda SVC Crest + Orbiting 3D Volleyball
          // Right Column: 3-Logo Pill -> Title -> Subtitle -> Official Pill
          // ============================================================
          const leftCX = Math.round(w * 0.265);
          const leftCY = Math.round(h * 0.49);
          if (assets.mainLogo) {
            const crestW = Math.round(u * 0.39 * scale);
            ctx.save();
            ctx.globalAlpha = clamp01(time / 0.45);
            ctx.shadowColor = 'rgba(30, 41, 59, 0.24)';
            ctx.shadowBlur = 28;
            ctx.drawImage(
              assets.mainLogo,
              leftCX - crestW / 2,
              leftCY - crestW / 2 + floatY,
              crestW,
              crestW
            );
            ctx.restore();
          }

          const vbD = Math.round(u * 0.155);
          drawBall3D(
            Math.round(w * 0.125 + p * (w * 0.025)),
            Math.round(h * 0.64 - vbArc),
            vbD,
            time * 2.2 + 0.35,
            time * 1.65 - 0.5,
            Math.sin(time * 1.2) * 0.45,
            {
              alpha: ballEnter,
              glowColor: 'rgba(255, 255, 255, 0.45)',
              shadowFloorOffset: Math.round(vbD * 0.68),
              camZ: 4.05 - p * 0.3,
            }
          );

          const rightCX = Math.round(w * 0.665);
          const rightMaxW = Math.round(w * 0.52);
          const pillH = Math.round(u * 0.102);
          let curY = Math.round(h * 0.165);
          drawThreeLogoPill(rightCX, curY, pillH);
          curY += pillH + Math.round(u * 0.042);

          ctx.save();
          const titleRes = drawWrappedBlock(
            ctx,
            (data.settings?.eventName || 'SMANSAGE VOLLEYBALL COMPETITION').toUpperCase(),
            rightCX,
            curY,
            rightMaxW,
            Math.round(u * 0.082),
            Math.round(u * 0.052),
            '800 {SIZE}px "Barlow Condensed", sans-serif',
            splitP,
            {
              liftPx: 34,
              stagger: 0.13,
              baseColor: '#0F172A',
              shineColor: '#B45309',
              shinePhase: time * 0.45,
            }
          );
          curY = titleRes.bottomY + Math.round(u * 0.024);

          const fittedSub = fitSingleLine(
            ctx,
            data.settings?.eventSubtitle || 'AVERSA • Dies Natalis 44',
            rightMaxW,
            Math.round(u * 0.032),
            Math.round(u * 0.022),
            '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.globalAlpha = subP;
          ctx.textAlign = 'center';
          ctx.fillStyle = '#78350F';
          ctx.font = `700 ${fittedSub.fontSize}px "Plus Jakarta Sans", sans-serif`;
          const subBaseline = curY + Math.round(fittedSub.fontSize * 0.85);
          ctx.fillText(fittedSub.text, rightCX, subBaseline + (1 - subP) * 14);
          curY = subBaseline + Math.round(u * 0.042);

          const tagW = Math.round(u * 0.56);
          const tagH = Math.round(u * 0.064);
          drawRoundedRect(ctx, rightCX - tagW / 2, curY + (1 - subP) * 16, tagW, tagH, 999);
          ctx.fillStyle = '#0F172A';
          ctx.fill();
          ctx.font = `800 ${Math.round(u * 0.029)}px "Plus Jakarta Sans", sans-serif`;
          fillShinyText(
            ctx,
            officialTagLabel,
            rightCX,
            curY + (1 - subP) * 16 + tagH * 0.66,
            time * 0.5,
            '#F5C538',
            '#FFFFFF'
          );
          ctx.restore();
          return;
        }



        // ============================================================
        // 9:16, 4:5, & 1:1 SEQUENTIAL Y-CURSOR FLOW (0% Overlap)
        // ============================================================
        const availH = h - safeTop - safeBottom;
        const pillH = Math.round(u * (isSquare ? 0.092 : 0.112));
        const pillY = safeTop;
        drawThreeLogoPill(w / 2, pillY, pillH);

        const tagH = Math.round(u * (isSquare ? 0.056 : 0.064));
        const tagW = Math.round(u * (isSquare ? 0.58 : 0.64));
        const tagY = h - safeBottom - tagH;

        const crestNominal = Math.round(
          availH * (isStory ? 0.275 : isPost45 ? 0.27 : 0.255)
        );
        const crestTop = pillY + pillH + Math.round(availH * 0.032);
        const crestCY = crestTop + Math.round(crestNominal / 2);

        // 3D Volleyball strictly inside upper-left of Crest band (never drops into title!)
        const vbDiameter = Math.round(u * (isSquare ? 0.125 : 0.155));
        drawBall3D(
          Math.round(w * 0.155 + p * (w * 0.04)),
          Math.round(crestTop + crestNominal * 0.44 - vbArc * 0.5),
          vbDiameter,
          time * 2.2 + 0.35,
          time * 1.65 - 0.5,
          Math.sin(time * 1.2) * 0.45,
          {
            alpha: ballEnter,
            glowColor: 'rgba(255, 255, 255, 0.45)',
            shadowFloorOffset: Math.round(vbDiameter * 0.65),
            camZ: 4.1 - p * 0.35,
          }
        );

        if (assets.mainLogo) {
          const logoW = Math.round(crestNominal * scale);
          ctx.save();
          ctx.globalAlpha = clamp01(time / 0.45);
          ctx.shadowColor = 'rgba(30, 41, 59, 0.22)';
          ctx.shadowBlur = 24;
          ctx.drawImage(
            assets.mainLogo,
            (w - logoW) / 2,
            crestCY - logoW / 2 + floatY * 0.6,
            logoW,
            logoW
          );
          ctx.restore();
        }

        const titleTopY = crestTop + crestNominal + Math.round(availH * 0.03);
        ctx.save();
        const titleRes = drawWrappedBlock(
          ctx,
          (data.settings?.eventName || 'SMANSAGE VOLLEYBALL COMPETITION').toUpperCase(),
          w / 2,
          titleTopY,
          w * 0.88,
          Math.round(u * (isSquare ? 0.068 : 0.082)),
          Math.round(u * (isSquare ? 0.048 : 0.054)),
          '800 {SIZE}px "Barlow Condensed", sans-serif',
          splitP,
          {
            liftPx: 32,
            stagger: 0.13,
            baseColor: '#0F172A',
            shineColor: '#B45309',
            shinePhase: time * 0.45,
          }
        );

        const fittedSub = fitSingleLine(
          ctx,
          data.settings?.eventSubtitle || 'AVERSA • Dies Natalis 44',
          w * 0.88,
          Math.round(u * (isSquare ? 0.028 : 0.033)),
          Math.round(u * 0.02),
          '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
        );
        ctx.globalAlpha = subP;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#78350F';
        ctx.font = `700 ${fittedSub.fontSize}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillText(
          fittedSub.text,
          w / 2,
          titleRes.bottomY + Math.round(fittedSub.fontSize * 1.15) + (1 - subP) * 14
        );

        drawRoundedRect(ctx, (w - tagW) / 2, tagY + (1 - subP) * 16, tagW, tagH, 999);
        ctx.fillStyle = '#0F172A';
        ctx.fill();
        ctx.font = `800 ${Math.round(tagH * 0.46)}px "Plus Jakarta Sans", sans-serif`;
        fillShinyText(
          ctx,
          officialTagLabel,
          w / 2,
          tagY + (1 - subP) * 16 + tagH * 0.66,
          time * 0.5,
          '#F5C538',
          '#FFFFFF'
        );
        ctx.restore();
      };

      // ----------------------------------------------------------------
      // LAYER HELPER B: Scene 3 (Matchup VS or Championship Coronation Reveal)
      // ----------------------------------------------------------------
      const drawScene3Matchup = (time: number, doorSplit: number) => {
    if (template === 'champion') {
          const enterP = clamp01((time - 4.32) / 0.88);
          const spotTeam =
            podiumVariant === 'runner_up'
              ? resolvedPodium2
              : podiumVariant === 'third_place'
                ? resolvedPodium3
                : resolvedPodium1;
          const spotLogo =
            podiumVariant === 'runner_up'
              ? assets.podium2Logo
              : podiumVariant === 'third_place'
                ? assets.podium3Logo
                : assets.podium1Logo;
          const rayPalette =
            podiumVariant === 'runner_up'
              ? ('silver' as const)
              : podiumVariant === 'third_place'
                ? ('bronze' as const)
                : ('gold' as const);
          const seamStroke =
            podiumVariant === 'runner_up'
              ? '#E2E8F0'
              : podiumVariant === 'third_place'
                ? '#FB923C'
                : '#FACC15';

          const renderRoyalBackdrop = () => {
            const royalGrad = ctx.createLinearGradient(0, 0, w, h);
            royalGrad.addColorStop(0, '#070B14');
            royalGrad.addColorStop(0.52, '#111A2E');
            royalGrad.addColorStop(1, '#1E1608');
            ctx.fillStyle = royalGrad;
            ctx.fillRect(-w * 0.6, -h * 0.6, w * 2.2, h * 2.2);

            drawAuroraAndBokeh(ctx, w, h, time, 0.65, 'dark');
            drawReactBitsLightRays(ctx, w, h, time, {
              intensity: 0.92 * easeOutCubic(enterP),
              palette: rayPalette,
              rayLengthRatio: 1.05,
              spreadRad: 0.6,
            });
          };

          // 1. TWO SYMMETRIC DIAGONAL ROYAL SHUTTER DOORS (100% Full Off-Screen Clearance!)
          if (isLandscape) {
            const sx = doorSplit * w * 0.68;

            // Left Door
            ctx.save();
            ctx.translate(-sx, 0);
            ctx.beginPath();
            ctx.moveTo(-w * 0.6, 0);
            ctx.lineTo(w * 0.54, 0);
            ctx.lineTo(w * 0.46, h);
            ctx.lineTo(-w * 0.6, h);
            ctx.closePath();
            ctx.clip();
            renderRoyalBackdrop();
            if (doorSplit > 0.005) {
              ctx.strokeStyle = seamStroke;
              ctx.lineWidth = Math.max(6, u * 0.007);
              ctx.beginPath();
              ctx.moveTo(w * 0.54, -20);
              ctx.lineTo(w * 0.46, h + 20);
              ctx.stroke();
            }
            ctx.restore();

            // Right Door
            ctx.save();
            ctx.translate(sx, 0);
            ctx.beginPath();
            ctx.moveTo(w * 0.54, 0);
            ctx.lineTo(w * 1.6, 0);
            ctx.lineTo(w * 1.6, h);
            ctx.lineTo(w * 0.46, h);
            ctx.closePath();
            ctx.clip();
            renderRoyalBackdrop();
            if (doorSplit > 0.005) {
              ctx.strokeStyle = seamStroke;
              ctx.lineWidth = Math.max(6, u * 0.007);
              ctx.beginPath();
              ctx.moveTo(w * 0.54, -20);
              ctx.lineTo(w * 0.46, h + 20);
              ctx.stroke();
            }
            ctx.restore();
          } else {
            const sx = doorSplit * w * 0.6;
            const sy = doorSplit * h * 0.84;

            // Upper-Left Door
            ctx.save();
            ctx.translate(-sx, -sy);
            ctx.beginPath();
            ctx.moveTo(-w * 0.6, -h * 0.6);
            ctx.lineTo(w * 1.6, -h * 0.6);
            ctx.lineTo(w * 1.6, h * 0.44 - 0.12 * (w * 0.6));
            ctx.lineTo(w, h * 0.44);
            ctx.lineTo(0, h * 0.56);
            ctx.lineTo(-w * 0.6, h * 0.56 + 0.12 * (w * 0.6));
            ctx.closePath();
            ctx.clip();
            renderRoyalBackdrop();
            if (doorSplit > 0.005) {
              ctx.strokeStyle = seamStroke;
              ctx.lineWidth = Math.max(6, u * 0.007);
              ctx.beginPath();
              ctx.moveTo(-w * 0.3, h * 0.56 + w * 0.036);
              ctx.lineTo(w * 1.3, h * 0.44 - w * 0.036);
              ctx.stroke();
            }
            ctx.restore();

            // Lower-Right Door
            ctx.save();
            ctx.translate(sx, sy);
            ctx.beginPath();
            ctx.moveTo(-w * 0.6, h * 0.56 + 0.12 * (w * 0.6));
            ctx.lineTo(0, h * 0.56);
            ctx.lineTo(w, h * 0.44);
            ctx.lineTo(w * 1.6, h * 0.44 - 0.12 * (w * 0.6));
            ctx.lineTo(w * 1.6, h * 1.6);
            ctx.lineTo(-w * 0.6, h * 1.6);
            ctx.closePath();
            ctx.clip();
            renderRoyalBackdrop();
            if (doorSplit > 0.005) {
              ctx.strokeStyle = seamStroke;
              ctx.lineWidth = Math.max(6, u * 0.007);
              ctx.beginPath();
              ctx.moveTo(-w * 0.3, h * 0.56 + w * 0.036);
              ctx.lineTo(w * 1.3, h * 0.44 - w * 0.036);
              ctx.stroke();
            }
            ctx.restore();
          }

          // 2. CORONATION CENTERPIECE WITH CAMERA ZOOM-THROUGH DISSOLVE
          const centerFade = 1 - smoothRange(0.02, 0.66, doorSplit);
          if (centerFade > 0.01) {
            const camZoom = 1 + doorSplit * 0.16;
            const floatCrest = Math.sin(time * 2.1) * 6;

            ctx.save();
            ctx.globalAlpha = centerFade;
            ctx.translate(w / 2, h / 2);
            ctx.scale(camZoom, camZoom);
            ctx.translate(-w / 2, -h / 2);

            drawVectorCrown(
              ctx,
              w / 2,
              safeTop + Math.round(u * 0.082),
              Math.round(u * 0.108 * easeOutBack(enterP)),
              seamStroke
            );

            ctx.textAlign = 'center';
            ctx.font = `800 ${Math.round(u * 0.044)}px "Plus Jakarta Sans", sans-serif`;
            fillShinyText(
              ctx,
              statusHeadline,
              w / 2,
              safeTop + Math.round(u * 0.19),
              time * 0.55,
              seamStroke,
              '#FFFFFF'
            );

            if (podiumVariant === 'podium_all') {
              const pList = [
                { rk: '1ST CHAMPION', tm: resolvedPodium1, col: '#FACC15' },
                { rk: '2ND RUNNER-UP', tm: resolvedPodium2, col: '#E2E8F0' },
                { rk: '3RD PLACE', tm: resolvedPodium3, col: '#FB923C' },
              ];
              let py = Math.round(h * 0.33);
              const cardH = Math.round(u * 0.13);
              pList.forEach((pItem, idx) => {
                const localE = easeOutQuint(clamp01((enterP - idx * 0.12) / 0.72));
                ctx.save();
                ctx.globalAlpha = centerFade * localE;
                const cw = Math.round(w * (isLandscape ? 0.64 : 0.84));
                const cx = Math.round((w - cw) / 2);
                drawRoundedRect(ctx, cx, py + (1 - localE) * 26, cw, cardH, 20);
                ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
                ctx.fill();
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = pItem.col;
                ctx.stroke();

                ctx.fillStyle = pItem.col;
                ctx.font = `800 ${Math.round(cardH * 0.25)}px "Plus Jakarta Sans", sans-serif`;
                ctx.fillText(pItem.rk, w / 2, py + (1 - localE) * 26 + cardH * 0.34);

                const fittedN = fitSingleLine(
                  ctx,
                  (pItem.tm?.name || 'TBD').toUpperCase(),
                  cw - 40,
                  Math.round(cardH * 0.38),
                  Math.round(cardH * 0.24),
                  '800 {SIZE}px "Barlow Condensed", sans-serif'
                );
                ctx.fillStyle = '#FFFFFF';
                ctx.font = `800 ${fittedN.fontSize}px "Barlow Condensed", sans-serif`;
                ctx.fillText(fittedN.text, w / 2, py + (1 - localE) * 26 + cardH * 0.78);
                ctx.restore();
                py += cardH + Math.round(u * 0.028);
              });
            } else {
              const crestScale = easeOutQuint(enterP);
              const crestR = Math.round(u * 0.245 * crestScale);
              const crestCY = h * 0.43 + floatCrest;

              // Soft golden aura ring behind the Winner Crest
              const crestGlow = ctx.createRadialGradient(
                w / 2,
                crestCY,
                crestR * 0.1,
                w / 2,
                crestCY,
                crestR * 0.92
              );
              crestGlow.addColorStop(0, 'rgba(250, 204, 21, 0.28)');
              crestGlow.addColorStop(1, 'rgba(250, 204, 21, 0)');
              ctx.fillStyle = crestGlow;
              ctx.beginPath();
              ctx.arc(w / 2, crestCY, crestR * 0.92, 0, Math.PI * 2);
              ctx.fill();

              if (spotLogo && crestR > 10) {
                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
                ctx.shadowBlur = 24;
                ctx.drawImage(
                  spotLogo,
                  w / 2 - crestR / 2,
                  crestCY - crestR / 2,
                  crestR,
                  crestR
                );
                ctx.restore();
              }

              const nameEnter = easeOutQuint(clamp01((enterP - 0.1) / 0.85));
              const nameLift = (1 - nameEnter) * 28;
              const fittedW = fitSingleLine(
                ctx,
                (spotTeam?.name || 'CHAMPIONS').toUpperCase(),
                w * 0.84,
                Math.round(u * 0.095),
                Math.round(u * 0.05),
                '800 {SIZE}px "Barlow Condensed", sans-serif'
              );
              ctx.save();
              ctx.globalAlpha = centerFade * nameEnter;
              ctx.font = `800 ${fittedW.fontSize}px "Barlow Condensed", sans-serif`;
              fillShinyText(
                ctx,
                fittedW.text,
                w / 2,
                Math.round(h * 0.66) + nameLift,
                time * 0.5,
                seamStroke,
                '#FFFFFF'
              );
              if (spotTeam?.school) {
                ctx.fillStyle = '#E2E8F0';
                ctx.font = `700 ${Math.round(u * 0.034)}px "Plus Jakarta Sans", sans-serif`;
                ctx.fillText(
                  spotTeam.school.toUpperCase(),
                  w / 2,
                  Math.round(h * 0.72) + nameLift
                );
              }
              ctx.restore();
            }

            ctx.fillStyle = '#FDE68A';
            ctx.font = `800 ${Math.round(u * 0.026)}px "Plus Jakarta Sans", sans-serif`;
            ctx.fillText(
              `${tournament?.name || 'SVC'} • ${data.settings?.eventName || ''}`.toUpperCase(),
              w / 2,
              h - safeBottom
            );
            ctx.restore();
          }

          // 3. SOFT VOLUMETRIC GOLDEN FLASH BLOOM ALONG THE PARTING SEAM
          if (doorSplit > 0.01 && doorSplit < 0.92) {
            const flashAlpha = Math.sin(clamp01(doorSplit / 0.92) * Math.PI) * 0.24;
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const flashGrad = ctx.createRadialGradient(
              w / 2,
              h / 2,
              0,
              w / 2,
              h / 2,
              Math.max(w, h) * 0.55
            );
            flashGrad.addColorStop(0, `rgba(254, 240, 138, ${flashAlpha.toFixed(3)})`);
            flashGrad.addColorStop(1, 'rgba(254, 240, 138, 0)');
            ctx.fillStyle = flashGrad;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
          }
          return;
        }

        const enterP = clamp01((time - 4.32) / 0.9);
        const teamBP = clamp01((time - 4.48) / 0.9);
        const drift = clamp01((time - 4.35) / 3.6) * 20 - 10;
        const splicedMatchA = splitTeamRegionName(teamA?.name || 'TIM A', teamA?.school);
        const splicedMatchB = splitTeamRegionName(teamB?.name || 'TIM B', teamB?.school);

        const renderTeamCenteredInBand = (
          spliced: { primary: string; region: string },
          cx: number,
          bandTop: number,
          bandBottom: number,
          maxColW: number,
          basePrimary: number,
          minPrimary: number,
          regionSize: number,
          prog: number,
          primaryCol: string,
          regionCol: string,
          shineCol?: string,
          logoImg?: HTMLImageElement | null
        ) => {
          const measured = measureWrappedBlock(
            ctx,
            spliced.primary,
            maxColW,
            basePrimary,
            minPrimary,
            '800 {SIZE}px "Barlow Condensed", sans-serif',
            2
          );
          const availBandH = Math.max(80, bandBottom - bandTop);
          const crestH = logoImg
            ? Math.min(Math.round(availBandH * 0.34), Math.round(u * (isSquare ? 0.1 : 0.128)))
            : 0;
          const crestGap = logoImg ? Math.round(crestH * 0.22) : 0;
          const regGap = spliced.region ? Math.round(regionSize * 0.42) : 0;
          const regH = spliced.region ? regionSize : 0;
          const blockTotalH = crestH + crestGap + measured.totalH + regGap + regH;
          const bandMid = (bandTop + bandBottom) / 2;
          let curTop = Math.max(bandTop, Math.round(bandMid - blockTotalH / 2));

          if (logoImg && crestH > 12) {
            const cScale = easeOutBack(clamp01(prog / 0.72));
            if (cScale > 0.02) {
              ctx.save();
              ctx.globalAlpha = easeOutCubic(clamp01(prog / 0.55));
              drawContainedCanvasImage(
                ctx,
                logoImg,
                cx,
                curTop + crestH / 2,
                crestH * cScale,
                crestH * cScale
              );
              ctx.restore();
            }
            curTop += crestH + crestGap;
          }

          const res = drawWrappedBlock(
            ctx,
            spliced.primary,
            cx,
            curTop,
            maxColW,
            basePrimary,
            minPrimary,
            '800 {SIZE}px "Barlow Condensed", sans-serif',
            prog,
            {
              liftPx: 36,
              stagger: 0.11,
              baseColor: primaryCol,
              shineColor: shineCol,
              shinePhase: shineCol ? time * 0.45 : undefined,
            }
          );

          if (spliced.region) {
            const fittedReg = fitSingleLine(
              ctx,
              spliced.region,
              maxColW,
              regionSize,
              Math.round(regionSize * 0.65),
              '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
            );
            ctx.save();
            ctx.globalAlpha = easeOutCubic(clamp01((prog - 0.22) / 0.78));
            ctx.textAlign = 'center';
            ctx.fillStyle = regionCol;
            ctx.font = `800 ${fittedReg.fontSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.fillText(
              fittedReg.text,
              cx,
              res.bottomY + regGap + Math.round(fittedReg.fontSize * 0.84)
            );
            ctx.restore();
          }
        };

        if (isLandscape) {
          // ============================================================
          // 16:9 LANDSCAPE: LEFT GOLD DOOR vs RIGHT SLATE DOOR (Full 100% Off-Screen Clearance)
          // ============================================================
          const slideX = doorSplit * w * 0.68;

          // 1. LEFT GOLD DOOR (Team A)
          ctx.save();
          ctx.translate(-slideX, 0);
          ctx.beginPath();
          ctx.moveTo(-w * 0.6, 0);
          ctx.lineTo(w * 0.54, 0);
          ctx.lineTo(w * 0.46, h);
          ctx.lineTo(-w * 0.6, h);
          ctx.closePath();
          ctx.clip();

          const leftGrad = ctx.createLinearGradient(0, 0, w * 0.54, h);
          leftGrad.addColorStop(0, '#FFFBEB');
          leftGrad.addColorStop(0.5, '#F9DC76');
          leftGrad.addColorStop(1, '#EAB308');
          ctx.fillStyle = leftGrad;
          ctx.fillRect(-w * 0.6, 0, w * 1.2, h);

          if (assets.netOfficial) {
            const nw = Math.round(u * 0.5);
            ctx.save();
            ctx.globalAlpha = 0.26;
            ctx.drawImage(assets.netOfficial, -drift * 0.5, 0, nw, nw);
            ctx.restore();
          }

          renderTeamCenteredInBand(
            splicedMatchA,
            Math.round(w * 0.235 - drift * 0.4),
            Math.round(h * 0.2),
            Math.round(h * 0.8),
            Math.round(w * 0.37),
            Math.round(u * 0.088),
            Math.round(u * 0.052),
            Math.round(u * 0.036),
            enterP,
            '#0F172A',
            '#78350F',
            undefined,
            assets.teamALogo
          );

          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = Math.max(8, u * 0.01);
          ctx.beginPath();
          ctx.moveTo(w * 0.54, -20);
          ctx.lineTo(w * 0.46, h + 20);
          ctx.stroke();
          ctx.restore();

          // 2. RIGHT SLATE DOOR (Team B)
          ctx.save();
          ctx.translate(slideX, 0);
          ctx.beginPath();
          ctx.moveTo(w * 0.54, 0);
          ctx.lineTo(w * 1.6, 0);
          ctx.lineTo(w * 1.6, h);
          ctx.lineTo(w * 0.46, h);
          ctx.closePath();
          ctx.clip();

          ctx.fillStyle = '#0F172A';
          ctx.fillRect(w * 0.4, 0, w * 1.2, h);
          drawAuroraAndBokeh(ctx, w, h, time, 0.55, 'dark');

          if (assets.spikerOfficial) {
            const sw = Math.round(u * 0.42);
            const sh = Math.round(sw * (395 / 268));
            ctx.save();
            ctx.globalAlpha = 0.15;
            ctx.drawImage(assets.spikerOfficial, w * 0.76 - drift * 0.5, h * 0.48, sw, sh);
            ctx.restore();
          }

          renderTeamCenteredInBand(
            splicedMatchB,
            Math.round(w * 0.765 + drift * 0.4),
            Math.round(h * 0.2),
            Math.round(h * 0.8),
            Math.round(w * 0.37),
            Math.round(u * 0.088),
            Math.round(u * 0.052),
            Math.round(u * 0.036),
            teamBP,
            '#FFFFFF',
            '#F9DC76',
            '#FDE68A',
            assets.teamBLogo
          );

          ctx.strokeStyle = '#F5C538';
          ctx.lineWidth = Math.max(6, u * 0.008);
          ctx.beginPath();
          ctx.moveTo(w * 0.54, -20);
          ctx.lineTo(w * 0.46, h + 20);
          ctx.stroke();
          ctx.restore();

          // 3. TOP BADGE, BOTTOM FOOTER, & CENTER VS MEDALLION
          const uiFade = 1 - easeInOutCubic(clamp01(doorSplit / 0.62));
          if (uiFade > 0.02) {
            ctx.save();
            ctx.globalAlpha = uiFade;
            const badgeW = Math.round(u * 0.54);
            const badgeH = Math.round(u * 0.062);
            const topBadgeY = safeTop;
            drawRoundedRect(ctx, (w - badgeW) / 2, topBadgeY, badgeW, badgeH, 999);
            ctx.fillStyle =
              template === 'final'
                ? '#0F172A'
                : template === 'upcoming'
                  ? '#0284C7'
                  : '#DC2626';
            ctx.fill();
            ctx.textAlign = 'center';
            ctx.fillStyle = template === 'final' ? '#F9DC76' : '#FFFFFF';
            ctx.font = `800 ${Math.round(badgeH * 0.48)}px "Plus Jakarta Sans", sans-serif`;
            ctx.fillText(statusHeadline, w / 2, topBadgeY + badgeH * 0.66);

            const scene3FooterRaw =
              template === 'upcoming'
                ? `${tournament?.name || 'SVC'} • ${resolvedScheduleLabel} • ${resolvedCourtLabel}`.toUpperCase()
                : `${tournament?.name || 'SVC'} • ${activeMatch?.courtName || 'Arena Utama'}`;
            const fittedS3FootL = fitSingleLine(
              ctx,
              scene3FooterRaw,
              Math.round(w * 0.88),
              Math.round(u * 0.028),
              Math.round(u * 0.02),
              '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
            );
            if (template === 'upcoming') {
              ctx.font = `800 ${fittedS3FootL.fontSize}px "Plus Jakarta Sans", sans-serif`;
              const fw = ctx.measureText(fittedS3FootL.text).width;
              const fPillH = Math.round(fittedS3FootL.fontSize * 1.9);
              const fPillW = Math.round(fw + fittedS3FootL.fontSize * 1.8);
              const fPillY = h - safeBottom - fPillH + 6;
              drawRoundedRect(ctx, (w - fPillW) / 2, fPillY, fPillW, fPillH, 999);
              ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
              ctx.fill();
              ctx.lineWidth = 2;
              ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
              ctx.stroke();
              ctx.fillStyle = '#FDE68A';
              ctx.textBaseline = 'middle';
              ctx.fillText(fittedS3FootL.text, w / 2, fPillY + fPillH / 2 + 1);
              ctx.textBaseline = 'alphabetic';
            } else {
              ctx.fillStyle = '#CBD5E1';
              ctx.font = `700 ${Math.round(u * 0.028)}px "Plus Jakarta Sans", sans-serif`;
              ctx.fillText(scene3FooterRaw, w / 2, h - safeBottom);
            }

            const medScale = easeOutBack(clamp01((time - 4.55) / 0.65)) * uiFade;
            const vsR = Math.round(u * 0.08 * medScale);
            if (vsR > 4) {
              ctx.beginPath();
              ctx.arc(w / 2, h * 0.5, vsR * 1.44, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
              ctx.fill();

              drawCircularText(
                ctx,
                'SMANSAGE VOLLEYBALL • AVERSA 44 • ',
                w / 2,
                h * 0.5,
                vsR * 1.22,
                time * 0.48,
                Math.max(9, Math.round(u * 0.014 * medScale)),
                '#F9DC76'
              );

              ctx.beginPath();
              ctx.arc(w / 2, h * 0.5, vsR, 0, Math.PI * 2);
              ctx.fillStyle = '#0F172A';
              ctx.fill();
              ctx.lineWidth = Math.max(4, u * 0.006);
              ctx.strokeStyle = '#F5C538';
              ctx.stroke();

              ctx.font = `800 ${Math.round(u * 0.068 * medScale)}px "Barlow Condensed", sans-serif`;
              fillShinyText(ctx, 'VS', w / 2, h * 0.5 + vsR * 0.3, time * 0.6, '#F5C538', '#FFFFFF');

              // Twin 3D Volleyballs cleanly ABOVE & BELOW VS along the slash (clear of Team A/B!)
              const flankSize = Math.round(u * 0.092 * medScale);
              drawBall3D(
                w * 0.522,
                h * 0.245 + Math.sin(time * 2.3) * 5,
                flankSize,
                time * 2.1,
                time * 1.6,
                0.35,
                { alpha: uiFade, glowColor: 'rgba(245, 197, 56, 0.28)' }
              );
              drawBall3D(
                w * 0.478,
                h * 0.755 - Math.sin(time * 2.3) * 5,
                flankSize,
                -time * 1.9,
                time * 2.0,
                -0.35,
                { alpha: uiFade, glowColor: 'rgba(245, 197, 56, 0.28)' }
              );
            }
            ctx.restore();
          }
          return;
        }

        // ============================================================
        // 9:16, 4:5, & 1:1: STRICT NON-OVERLAPPING BANDS AROUND VS (Full 100% Off-Screen Clearance)
        // ============================================================
        const splitShiftX = doorSplit * w * 0.58;
        const splitShiftY = doorSplit * h * 0.82;
        const badgeW = Math.round(u * 0.56);
        const badgeH = Math.round(u * (isSquare ? 0.054 : 0.064));
        const topBadgeY = safeTop + Math.round(u * 0.008);
        const baseVsR = Math.round(u * (isSquare ? 0.066 : isPost45 ? 0.076 : 0.084));
        const vsOuterR = Math.round(baseVsR * 1.46);
        const footerY = h - safeBottom - Math.round(u * 0.012);

        // 1. TOP GOLD DOOR (Team A strictly inside [topBadgeBottom + 16 .. h*0.5 - vsOuterR - 18])
        ctx.save();
        ctx.translate(-splitShiftX, -splitShiftY);
        ctx.beginPath();
        ctx.moveTo(-w * 0.5, -h * 0.5);
        ctx.lineTo(w * 1.5, -h * 0.5);
        ctx.lineTo(w * 1.5, h * 0.44 - 0.12 * (w * 0.5));
        ctx.lineTo(w, h * 0.44);
        ctx.lineTo(0, h * 0.56);
        ctx.lineTo(-w * 0.5, h * 0.56 + 0.12 * (w * 0.5));
        ctx.closePath();
        ctx.clip();

        const topDoorGrad = ctx.createLinearGradient(0, 0, w, h * 0.56);
        topDoorGrad.addColorStop(0, '#FFFBEB');
        topDoorGrad.addColorStop(0.45, '#F9DC76');
        topDoorGrad.addColorStop(1, '#EAB308');
        ctx.fillStyle = topDoorGrad;
        ctx.fillRect(-w * 0.5, -h * 0.5, w * 2, h * 1.2);

        if (assets.netOfficial) {
          const nw = Math.round(u * 0.52);
          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.drawImage(assets.netOfficial, -drift * 0.6, 0, nw, nw);
          ctx.restore();
        }

        drawRoundedRect(ctx, (w - badgeW) / 2, topBadgeY, badgeW, badgeH, 999);
        ctx.fillStyle =
          template === 'final'
            ? '#0F172A'
            : template === 'upcoming'
              ? '#0284C7'
              : '#DC2626';
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = template === 'final' ? '#F9DC76' : '#FFFFFF';
        ctx.font = `800 ${Math.round(badgeH * 0.48)}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillText(statusHeadline, w / 2, topBadgeY + badgeH * 0.66);

        renderTeamCenteredInBand(
          splicedMatchA,
          w / 2 - drift * 0.6,
          topBadgeY + badgeH + Math.round(u * 0.016),
          Math.round(h * 0.5 - vsOuterR - u * 0.018),
          Math.round(w * 0.86),
          Math.round(u * (isSquare ? 0.072 : isPost45 ? 0.086 : 0.098)),
          Math.round(u * 0.048),
          Math.round(u * (isSquare ? 0.03 : 0.038)),
          enterP,
          '#0F172A',
          '#78350F',
          undefined,
          assets.teamALogo
        );

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(8, u * 0.01);
        ctx.beginPath();
        ctx.moveTo(-w * 0.2, h * 0.56 + w * 0.024);
        ctx.lineTo(w * 1.2, h * 0.44 - w * 0.024);
        ctx.stroke();
        ctx.restore();

        // 2. BOTTOM DEEP SLATE DOOR (Team B strictly inside [h*0.5 + vsOuterR + 18 .. footerTop - 16])
        ctx.save();
        ctx.translate(splitShiftX, splitShiftY);
        ctx.beginPath();
        ctx.moveTo(-w * 0.5, h * 0.56 + 0.12 * (w * 0.5));
        ctx.lineTo(0, h * 0.56);
        ctx.lineTo(w, h * 0.44);
        ctx.lineTo(w * 1.5, h * 0.44 - 0.12 * (w * 0.5));
        ctx.lineTo(w * 1.5, h * 1.5);
        ctx.lineTo(-w * 0.5, h * 1.5);
        ctx.closePath();
        ctx.clip();

        ctx.fillStyle = '#0F172A';
        ctx.fillRect(-w * 0.5, h * 0.3, w * 2, h * 1.2);
        drawAuroraAndBokeh(ctx, w, h, time, 0.55, 'dark');

        if (assets.spikerOfficial) {
          const sw = Math.round(u * 0.42);
          const sh = Math.round(sw * (395 / 268));
          ctx.save();
          ctx.globalAlpha = 0.16;
          ctx.drawImage(assets.spikerOfficial, w * 0.61 - drift * 0.8, h * 0.53, sw, sh);
          ctx.restore();
        }

        renderTeamCenteredInBand(
          splicedMatchB,
          w / 2 + drift * 0.6,
          Math.round(h * 0.5 + vsOuterR + u * 0.02),
          footerY - Math.round(u * 0.046),
          Math.round(w * 0.86),
          Math.round(u * (isSquare ? 0.072 : isPost45 ? 0.086 : 0.098)),
          Math.round(u * 0.048),
          Math.round(u * (isSquare ? 0.03 : 0.038)),
          teamBP,
          '#FFFFFF',
          '#F9DC76',
          '#FDE68A',
          assets.teamBLogo
        );

        ctx.textAlign = 'center';
        const portraitS3FooterRaw =
          template === 'upcoming'
            ? `${tournament?.name || 'SVC'} • ${resolvedScheduleLabel} • ${resolvedCourtLabel}`.toUpperCase()
            : `${tournament?.name || 'SVC'} • ${activeMatch?.courtName || 'Arena Utama'}`;
        if (template === 'upcoming') {
          const fittedFootP = fitSingleLine(
            ctx,
            portraitS3FooterRaw,
            w - pad * 2 - 28,
            Math.round(u * (isSquare ? 0.025 : 0.029)),
            Math.round(u * 0.019),
            '800 {SIZE}px "Plus Jakarta Sans", sans-serif'
          );
          ctx.font = `800 ${fittedFootP.fontSize}px "Plus Jakarta Sans", sans-serif`;
          const fw = ctx.measureText(fittedFootP.text).width;
          const fPillH = Math.round(fittedFootP.fontSize * 1.9);
          const fPillW = Math.min(w - pad * 2, Math.round(fw + fittedFootP.fontSize * 1.8));
          const fPillY = footerY - fPillH + Math.round(u * 0.01);
          drawRoundedRect(ctx, (w - fPillW) / 2, fPillY, fPillW, fPillH, 999);
          ctx.fillStyle = 'rgba(2, 132, 199, 0.24)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(245, 197, 56, 0.6)';
          ctx.stroke();
          ctx.fillStyle = '#FDE68A';
          ctx.textBaseline = 'middle';
          ctx.fillText(fittedFootP.text, w / 2, fPillY + fPillH / 2 + 1);
          ctx.textBaseline = 'alphabetic';
        } else {
          ctx.fillStyle = '#CBD5E1';
          ctx.font = `700 ${Math.round(u * (isSquare ? 0.026 : 0.031))}px "Plus Jakarta Sans", sans-serif`;
          ctx.fillText(portraitS3FooterRaw, w / 2, footerY);
        }

        ctx.strokeStyle = '#F5C538';
        ctx.lineWidth = Math.max(6, u * 0.008);
        ctx.beginPath();
        ctx.moveTo(-w * 0.2, h * 0.56 + w * 0.024);
        ctx.lineTo(w * 1.2, h * 0.44 - w * 0.024);
        ctx.stroke();
        ctx.restore();

        // 3. CENTER MEDALLION: VS + CircularText + Twin 3D Volleyballs along the slash
        const medallionEnter = easeOutBack(clamp01((time - 4.55) / 0.65));
        const medallionExit = 1 - easeInOutCubic(clamp01(doorSplit / 0.62));
        const medScale = medallionEnter * medallionExit;
        if (medScale > 0.02) {
          const vsR = Math.round(baseVsR * medScale);
          ctx.save();
          ctx.globalAlpha = clamp01(medallionExit);

          ctx.beginPath();
          ctx.arc(w / 2, h * 0.5, vsR * 1.44, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
          ctx.fill();

          drawCircularText(
            ctx,
            'SMANSAGE VOLLEYBALL • AVERSA 44 • ',
            w / 2,
            h * 0.5,
            vsR * 1.22,
            time * 0.48,
            Math.max(8, Math.round(u * 0.0135 * medScale)),
            '#F9DC76'
          );

          ctx.beginPath();
          ctx.arc(w / 2, h * 0.5, vsR, 0, Math.PI * 2);
          ctx.fillStyle = '#0F172A';
          ctx.fill();
          ctx.lineWidth = Math.max(4, u * 0.006);
          ctx.strokeStyle = '#F5C538';
          ctx.stroke();

          ctx.textAlign = 'center';
          ctx.font = `800 ${Math.round(vsR * 0.82)}px "Barlow Condensed", sans-serif`;
          fillShinyText(
            ctx,
            'VS',
            w / 2,
            h * 0.5 + vsR * 0.3,
            time * 0.6,
            '#F5C538',
            '#FFFFFF'
          );

          const flankSize = Math.round(u * (isSquare ? 0.082 : 0.098) * medScale);
          const flankDist = Math.round(vsR * 1.44 + flankSize * 0.74);
          drawBall3D(
            w / 2 - flankDist,
            h * 0.5 + vsR * 0.22 + Math.sin(time * 2.3) * 5,
            flankSize,
            time * 2.1,
            time * 1.6,
            0.35,
            { alpha: clamp01(medallionExit), glowColor: 'rgba(245, 197, 56, 0.28)' }
          );
          drawBall3D(
            w / 2 + flankDist,
            h * 0.5 - vsR * 0.22 - Math.sin(time * 2.3) * 5,
            flankSize,
            -time * 1.9,
            time * 2.0,
            -0.35,
            { alpha: clamp01(medallionExit), glowColor: 'rgba(245, 197, 56, 0.28)' }
          );
          ctx.restore();
        }
      };

      // ----------------------------------------------------------------
      // LAYER HELPER C: Scene 5 (Organizer + AVERSA + 2-Tier Top-3 Principal Sponsors)
      // ----------------------------------------------------------------
      const drawScene5Outro = (time: number, outroStartSec: number) => {
        const rel = Math.max(0, time - outroStartSec);
        const p = clamp01(rel / 4.5);
        const contentEase = easeOutQuint(clamp01((rel - 0.35) / 0.95));
        const parallaxLift = (1 - contentEase) * 38 - p * 8;

        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, w, h);
        drawAuroraAndBokeh(ctx, w, h, time, 0.85, 'dark');

        // Top Gold Diagonal Broadcast Header
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(w, 0);
        ctx.lineTo(w, h * 0.085);
        ctx.lineTo(0, h * 0.125);
        ctx.closePath();
        ctx.fillStyle = '#F9DC76';
        ctx.fill();
        ctx.restore();

        if (assets.netOfficial) {
          const nw = Math.round(u * 0.46);
          ctx.save();
          ctx.globalAlpha = 0.2;
          ctx.drawImage(assets.netOfficial, -p * 14, -p * 10, nw, nw);
          ctx.restore();
        }
        if (assets.spikerOfficial) {
          const sw = Math.round(u * 0.4);
          const sh = Math.round(sw * (395 / 268));
          ctx.save();
          ctx.globalAlpha = 0.11;
          ctx.drawImage(assets.spikerOfficial, w - sw * 0.88 - p * 14, h - sh * 0.88, sw, sh);
          ctx.restore();
        }

        // Helper: Draw Broadcast Section Pill Badge (like UPCOMING / LIVE badges)
        const drawOutroPillBadge = (
          label: string,
          cx: number,
          topY: number,
          fontSize: number,
          variant: 'organizer' | 'sponsor'
        ): number => {
          ctx.save();
          ctx.font = `800 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
          const textW = ctx.measureText(label).width;
          const padX = Math.round(fontSize * 1.05);
          const pillH = Math.round(fontSize * 1.95);
          const pillW = Math.round(textW + padX * 2);
          const rx = Math.round(cx - pillW / 2);

          drawRoundedRect(ctx, rx, topY, pillW, pillH, pillH / 2);
          if (variant === 'sponsor') {
            ctx.fillStyle = '#F5C538';
            ctx.fill();
            ctx.fillStyle = '#0F172A';
          } else {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(245, 197, 56, 0.65)';
            ctx.stroke();
            ctx.fillStyle = '#F5C538';
          }

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, cx, topY + pillH / 2 + 1);
          ctx.restore();
          return pillH;
        };

        // Helper: Compute & Render Tight-Hugged 2-Tier Sponsor Block (Directly attached under Pill Badge)
        const measureSponsorBlock = (maxBlockH: number) => {
          const visible = assets.sponsors.slice(0, 8);
          const tier1 = visible.slice(0, 3);
          const tier2 = visible.slice(3);
          const pillFont = Math.round(u * (isSquare ? 0.021 : 0.024));
          const pillH = Math.round(pillFont * 1.95);
          const pillToLogoGap = Math.round(u * 0.022);
          const rowGap = tier2.length > 0 ? Math.round(u * 0.02) : 0;

          const availLogosH = Math.max(
            72,
            maxBlockH - pillH - pillToLogoGap - rowGap
          );

          let tier1H = 0;
          let tier2H = 0;
          if (tier2.length === 0) {
            tier1H = Math.min(Math.round(u * 0.185), availLogosH);
          } else {
            tier1H = Math.min(Math.round(u * 0.155), Math.round(availLogosH * 0.62));
            tier2H = Math.min(
              Math.round(u * 0.095),
              Math.max(46, availLogosH - tier1H)
            );
          }

          const totalH =
            pillH + pillToLogoGap + tier1H + (tier2.length > 0 ? rowGap + tier2H : 0);
          return {
            visible,
            tier1,
            tier2,
            pillFont,
            pillH,
            pillToLogoGap,
            rowGap,
            tier1H,
            tier2H,
            totalH,
          };
        };

        const renderTightSponsorBlock = (
          areaCX: number,
          blockTopY: number,
          areaMaxW: number,
          layout: ReturnType<typeof measureSponsorBlock>
        ) => {
          if (layout.visible.length === 0) return;

          drawOutroPillBadge(
            'SUPPORTED BY & MEDIA PARTNER',
            areaCX,
            blockTopY,
            layout.pillFont,
            'sponsor'
          );

          const renderSponsorRow = (
            rowItems: typeof layout.visible,
            rowTopY: number,
            targetSlotW: number,
            targetSlotH: number,
            gapX: number,
            baseIdx: number,
            isPrincipalRow: boolean
          ) => {
            if (rowItems.length === 0) return;
            const rawTotalW =
              rowItems.length * targetSlotW + (rowItems.length - 1) * gapX;
            const shrink = rawTotalW > areaMaxW ? areaMaxW / rawTotalW : 1;
            const slotW = Math.round(targetSlotW * shrink);
            const slotH = Math.round(targetSlotH * shrink);
            const gap = Math.round(gapX * shrink);
            const totalW = rowItems.length * slotW + (rowItems.length - 1) * gap;
            let curX = areaCX - totalW / 2;

            rowItems.forEach((sp, idx) => {
              const globalIdx = baseIdx + idx;
              const itemT = easeOutQuint(
                clamp01((rel - 0.7 - globalIdx * 0.1) / 0.65)
              );
              ctx.save();
              ctx.globalAlpha = itemT;
              ctx.translate(0, (1 - itemT) * 20);

              const showWhiteBox = Boolean(sp.item.boxed && !sp.item.darkLogoUrl);
              if (showWhiteBox) {
                drawRoundedRect(ctx, curX, rowTopY, slotW, slotH, isPrincipalRow ? 18 : 12);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.fill();
              }

              if (sp.img) {
                const padBox = showWhiteBox ? Math.round(slotH * 0.1) : 0;
                const availW = Math.max(20, slotW - padBox * 2);
                const availH = Math.max(20, slotH - padBox * 2);
                const scale = Math.min(availW / sp.img.width, availH / sp.img.height);
                const dw = sp.img.width * scale;
                const dh = sp.img.height * scale;
                ctx.drawImage(
                  sp.img,
                  curX + (slotW - dw) / 2,
                  rowTopY + (slotH - dh) / 2,
                  dw,
                  dh
                );
              }
              ctx.restore();
              curX += slotW + gap;
            });
          };

          // Hugged directly beneath the Pill Badge (no floating dead gap!)
          const row1TopY = blockTopY + layout.pillH + layout.pillToLogoGap;
          const tier1W = Math.round(layout.tier1H * 1.7);
          renderSponsorRow(
            layout.tier1,
            row1TopY,
            tier1W,
            layout.tier1H,
            Math.round(u * 0.028),
            0,
            true
          );

          if (layout.tier2.length > 0) {
            const row2TopY = row1TopY + layout.tier1H + layout.rowGap;
            const tier2W = Math.round(layout.tier2H * 1.65);
            renderSponsorRow(
              layout.tier2,
              row2TopY,
              tier2W,
              layout.tier2H,
              Math.round(u * 0.022),
              3,
              false
            );
          }
        };

        ctx.save();
        ctx.globalAlpha = clamp01((rel - 0.25) / 0.6);
        ctx.translate(0, parallaxLift);

        // Safe playable vertical band (clears top diagonal header AND IG/Reels safe zones)
        const topSafeBound = Math.max(safeTop + 10, Math.round(h * 0.145));
        const bottomSafeBound = h - Math.max(safeBottom + 10, Math.round(h * 0.07));
        const safeBandH = Math.max(220, bottomSafeBound - topSafeBound);

        if (isLandscape) {
          // ============================================================
          // 16:9 LANDSCAPE 2-COLUMN OUTRO (Both Columns Vertically Centered & Hugged)
          // ============================================================
          const hasSponsors = assets.sponsors.length > 0;
          const leftCX = hasSponsors ? Math.round(w * 0.24) : Math.round(w * 0.5);
          const leftMaxW = hasSponsors ? Math.round(w * 0.38) : Math.round(w * 0.72);

          const orgPillFont = Math.round(u * 0.023);
          const orgPillH = Math.round(orgPillFont * 1.95);
          const orgGap1 = Math.round(u * 0.024);
          const orgSize = Math.round(u * 0.175);
          const orgGap2 = Math.round(u * 0.026);
          const schoolFontMax = Math.round(u * 0.048);
          const metaFont = Math.round(u * 0.025);
          const leftTotalH =
            orgPillH + orgGap1 + orgSize + orgGap2 + schoolFontMax + Math.round(metaFont * 1.4);

          let curY = topSafeBound + Math.max(0, Math.round((safeBandH - leftTotalH) / 2));

          drawOutroPillBadge('DISELENGGARAKAN OLEH', leftCX, curY, orgPillFont, 'organizer');
          curY += orgPillH + orgGap1;

          const coH = Math.round(orgSize * 0.54);
          const coW = assets.coLogo
            ? Math.round(coH * (assets.coLogo.width / Math.max(1, assets.coLogo.height)))
            : 0;
          const pairGap = Math.round(u * 0.035);
          const pairW =
            (assets.organizerLogo ? orgSize : 0) +
            (assets.organizerLogo && assets.coLogo ? pairGap : 0) +
            coW;
          let lx = leftCX - pairW / 2;
          if (assets.organizerLogo) {
            ctx.drawImage(assets.organizerLogo, lx, curY, orgSize, orgSize);
            lx += orgSize + pairGap;
          }
          if (assets.coLogo) {
            ctx.drawImage(assets.coLogo, lx, curY + (orgSize - coH) / 2, coW, coH);
          }
          curY += orgSize + orgGap2;

          const schoolBlock = drawWrappedBlock(
            ctx,
            'SMA NEGERI 1 GEDEG • AVERSA 44',
            leftCX,
            curY,
            leftMaxW,
            schoolFontMax,
            Math.round(u * 0.034),
            '800 {SIZE}px "Barlow Condensed", sans-serif',
            1,
            {
              liftPx: 0,
              baseColor: '#FFFFFF',
              shineColor: '#FDE68A',
              shinePhase: time * 0.42,
            }
          );

          ctx.textAlign = 'center';
          ctx.fillStyle = '#CBD5E1';
          ctx.font = `600 ${metaFont}px "Plus Jakarta Sans", sans-serif`;
          ctx.fillText(
            data.settings?.eventMeta || '1982 - 2026 • Mojokerto',
            leftCX,
            schoolBlock.bottomY + Math.round(metaFont * 1.25)
          );

          if (hasSponsors) {
            ctx.strokeStyle = 'rgba(245, 197, 56, 0.25)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(w * 0.45, topSafeBound + safeBandH * 0.1);
            ctx.lineTo(w * 0.45, bottomSafeBound - safeBandH * 0.1);
            ctx.stroke();

            const spLayout = measureSponsorBlock(Math.round(safeBandH * 0.86));
            const spTopY =
              topSafeBound + Math.max(0, Math.round((safeBandH - spLayout.totalH) / 2));
            renderTightSponsorBlock(
              Math.round(w * 0.72),
              spTopY,
              Math.round(w * 0.48),
              spLayout
            );
          }
          ctx.restore();
          return;
        }



        // ============================================================
        // 9:16, 4:5, & 1:1 CENTERED & TIGHTLY HUGGED OUTRO STACK
        // ============================================================
        const hasSponsors = assets.sponsors.length > 0;
        const orgPillFont = Math.round(u * (isSquare ? 0.022 : 0.025));
        const orgPillH = Math.round(orgPillFont * 1.95);
        const gapPillToLogos = Math.round(u * 0.022);
        const orgSize = Math.round(
          u * (isSquare ? 0.145 : isPost45 ? 0.168 : 0.19)
        );
        const gapLogosToTitle = Math.round(u * 0.024);

        const fittedSchool = fitSingleLine(
          ctx,
          'SMA NEGERI 1 GEDEG • AVERSA 44',
          w - pad * 2,
          Math.round(u * (isSquare ? 0.046 : 0.054)),
          Math.round(u * 0.033),
          '800 {SIZE}px "Barlow Condensed", sans-serif'
        );
        const titleH = Math.round(fittedSchool.fontSize * 0.95);
        const metaFont = Math.round(u * (isSquare ? 0.024 : 0.028));
        const metaH = Math.round(metaFont * 1.35);

        const organizerBlockH =
          orgPillH + gapPillToLogos + orgSize + gapLogosToTitle + titleH + metaH;
        const sectionGap = hasSponsors ? Math.round(u * (isSquare ? 0.032 : 0.04)) : 0;
        const maxSponsorAllocH = Math.max(
          110,
          safeBandH - organizerBlockH - sectionGap
        );
        const spLayout = hasSponsors ? measureSponsorBlock(maxSponsorAllocH) : null;
        const totalStackH =
          organizerBlockH + (spLayout ? sectionGap + spLayout.totalH : 0);

        // Vertically center the entire tight stack inside [topSafeBound, bottomSafeBound]
        let curY = topSafeBound + Math.max(0, Math.round((safeBandH - totalStackH) / 2));

        drawOutroPillBadge('DISELENGGARAKAN OLEH', w / 2, curY, orgPillFont, 'organizer');
        curY += orgPillH + gapPillToLogos;

        const coH = Math.round(orgSize * 0.56);
        const coW = assets.coLogo
          ? Math.round(coH * (assets.coLogo.width / Math.max(1, assets.coLogo.height)))
          : 0;
        const pairGap = Math.round(u * 0.045);
        const pairW =
          (assets.organizerLogo ? orgSize : 0) +
          (assets.organizerLogo && assets.coLogo ? pairGap : 0) +
          coW;
        let lx = w / 2 - pairW / 2;
        if (assets.organizerLogo) {
          ctx.drawImage(assets.organizerLogo, lx, curY, orgSize, orgSize);
          lx += orgSize + pairGap;
        }
        if (assets.coLogo) {
          ctx.drawImage(assets.coLogo, lx, curY + (orgSize - coH) / 2, coW, coH);
        }
        curY += orgSize + gapLogosToTitle;

        ctx.textAlign = 'center';
        ctx.font = `800 ${fittedSchool.fontSize}px "Barlow Condensed", sans-serif`;
        const schoolBaseY = curY + Math.round(fittedSchool.fontSize * 0.85);
        fillShinyText(
          ctx,
          fittedSchool.text,
          w / 2,
          schoolBaseY,
          time * 0.42,
          '#FFFFFF',
          '#FDE68A'
        );

        ctx.fillStyle = '#CBD5E1';
        ctx.font = `600 ${metaFont}px "Plus Jakarta Sans", sans-serif`;
        const metaBaseY = schoolBaseY + metaH;
        ctx.fillText(
          data.settings?.eventMeta || '1982 - 2026 • Mojokerto',
          w / 2,
          metaBaseY
        );

        if (spLayout) {
          const sponsorTop = metaBaseY + sectionGap;
          renderTightSponsorBlock(w / 2, sponsorTop, w - pad * 2, spLayout);
        }
        ctx.restore();
      };

      // ================================================================
      // COMPOSITE TIMELINE WITH SMOOTH OVERLAPPING TRANSITIONS
      // ================================================================

      const skipMatchup =
        template === 'schedule_day' ||
        template === 'bracket' ||
        isNonMatchTemplate(template);

      // 0. DIRECT TO SCENE 4 WHEN INTRO IS DISABLED
      if (!includeIntro) {
        const shouldRunOutroDirect = includeOutro && t >= timeline.outroStartSec;
        if (!shouldRunOutroDirect) {
          drawPhotoAndScoreboard(t, clamp01(t / 0.65), true, t);
          drawSafeZoneOverlay();
          return;
        }
        if (t < timeline.outroWipeEndSec) {
          drawPhotoAndScoreboard(t, 1, true, t);
          const wipeP = easeFluidCurtain(
            clamp01((t - timeline.outroStartSec) / 1.08)
          );
          const leadX = -w * 0.45 + wipeP * (w * 2.15);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(-w * 0.6, 0);
          ctx.lineTo(leadX, 0);
          ctx.lineTo(leadX - w * 0.35, h);
          ctx.lineTo(-w * 0.95, h);
          ctx.closePath();
          ctx.clip();
          drawScene5Outro(t, timeline.outroStartSec);
          ctx.restore();
          ctx.save();
          ctx.fillStyle = '#F5C538';
          ctx.beginPath();
          ctx.moveTo(leadX - w * 0.045, 0);
          ctx.lineTo(leadX + w * 0.02, 0);
          ctx.lineTo(leadX - w * 0.33, h);
          ctx.lineTo(leadX - w * 0.395, h);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          drawSafeZoneOverlay();
          return;
        }
        drawScene5Outro(t, timeline.outroStartSec);
        drawSafeZoneOverlay();
        return;
      }

      // 1. INTRO & STINGER WIPES (0.0s - 5.25s)
      if (t < 5.25) {
        if (t < 4.4) {
          drawScene1Intro(t);
        } else if (skipMatchup) {
          drawPhotoAndScoreboard(Math.max(0, t - 4.4), clamp01((t - 4.4) / 0.85), true, t);
        } else {
          drawScene3Matchup(t, 0);
        }

        if (t >= 2.55) {
          if (t < 4.4) {
            const wipeIn = clamp01((t - 2.55) / 0.78);
            const ribbons = [
              { col: '#E09D17', delay: 0, span: 0.7 },
              { col: '#1E293B', delay: 0.09, span: 0.72 },
              { col: '#0B0F19', delay: 0.18, span: 0.78 },
            ];
            for (const rb of ribbons) {
              const rp = easeFluidCurtain(clamp01((wipeIn - rb.delay) / rb.span));
              if (rp <= 0) continue;
              const leadX = -w * 0.45 + rp * (w * 2.15);
              ctx.save();
              ctx.fillStyle = rb.col;
              ctx.beginPath();
              ctx.moveTo(-w * 0.6, 0);
              ctx.lineTo(leadX, 0);
              ctx.lineTo(leadX - w * 0.35, h);
              ctx.lineTo(-w * 0.95, h);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }

            if (wipeIn > 0.45) {
              const stingerAmb = clamp01((wipeIn - 0.45) / 0.55);
              drawAuroraAndBokeh(ctx, w, h, t, stingerAmb * 0.78, 'dark');
              drawReactBitsLightRays(ctx, w, h, t, {
                intensity: stingerAmb * 0.48,
                palette: 'gold',
                rayLengthRatio: 0.85,
              });
            }
          } else {
            // 4.40s..5.25s: Split dark stinger curtain along Scene 3's exact slash angle (fluid zero-lag curve)!
            const openP = easeFluidCurtain(clamp01((t - 4.4) / 0.82));
            if (isLandscape) {
              const sx = openP * w * 0.68;
              ctx.save();
              ctx.translate(-sx, 0);
              ctx.fillStyle = '#0B0F19';
              ctx.beginPath();
              ctx.moveTo(-w * 0.6, 0);
              ctx.lineTo(w * 0.54, 0);
              ctx.lineTo(w * 0.46, h);
              ctx.lineTo(-w * 0.6, h);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = '#F5C538';
              ctx.lineWidth = Math.max(8, u * 0.01);
              ctx.beginPath();
              ctx.moveTo(w * 0.54, 0);
              ctx.lineTo(w * 0.46, h);
              ctx.stroke();
              ctx.restore();

              ctx.save();
              ctx.translate(sx, 0);
              ctx.fillStyle = '#0B0F19';
              ctx.beginPath();
              ctx.moveTo(w * 0.54, 0);
              ctx.lineTo(w * 1.6, 0);
              ctx.lineTo(w * 1.6, h);
              ctx.lineTo(w * 0.46, h);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = '#F5C538';
              ctx.lineWidth = Math.max(8, u * 0.01);
              ctx.beginPath();
              ctx.moveTo(w * 0.54, 0);
              ctx.lineTo(w * 0.46, h);
              ctx.stroke();
              ctx.restore();
            } else {
              const sx = openP * w * 0.58;
              const sy = openP * h * 0.82;

              ctx.save();
              ctx.translate(-sx, -sy);
              ctx.fillStyle = '#0B0F19';
              ctx.beginPath();
              ctx.moveTo(-w * 0.5, -h * 0.5);
              ctx.lineTo(w * 1.5, -h * 0.5);
              ctx.lineTo(w, h * 0.44);
              ctx.lineTo(0, h * 0.56);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = '#F5C538';
              ctx.lineWidth = Math.max(8, u * 0.01);
              ctx.beginPath();
              ctx.moveTo(0, h * 0.56);
              ctx.lineTo(w, h * 0.44);
              ctx.stroke();
              ctx.restore();

              ctx.save();
              ctx.translate(sx, sy);
              ctx.fillStyle = '#0B0F19';
              ctx.beginPath();
              ctx.moveTo(0, h * 0.56);
              ctx.lineTo(w, h * 0.44);
              ctx.lineTo(w * 1.5, h * 1.5);
              ctx.lineTo(-w * 0.5, h * 1.5);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = '#F5C538';
              ctx.lineWidth = Math.max(8, u * 0.01);
              ctx.beginPath();
              ctx.moveTo(0, h * 0.56);
              ctx.lineTo(w, h * 0.44);
              ctx.stroke();
              ctx.restore();
            }
          }

          // Stinger Centerpiece: Sequential Centered Group (3D Ball -> Headline -> Sub-caption)
          if (t >= 2.95 && t <= 4.9) {
            const textEnter = clamp01((t - 3.05) / 0.55);
            const textExit = t > 4.38 ? 1 - easeInOutCubic(clamp01((t - 4.38) / 0.48)) : 1;
            const ballEnter = easeOutBack(clamp01((t - 2.95) / 0.52));
            const slowDrift = (t - 3.7) * -16;

            if (textExit > 0.01) {
              const nominalBallD = Math.round(
                u * (isLandscape || isSquare ? 0.19 : 0.225)
              );
              const stingerBallSize = Math.round(
                nominalBallD * ballEnter * (0.92 + 0.08 * textExit)
              );
              const headBase = Math.round(u * (isLandscape ? 0.092 : 0.102));
              const headMin = Math.round(u * 0.062);
              const measuredHead = measureWrappedBlock(
                ctx,
                statusHeadline,
                w * 0.88,
                headBase,
                headMin,
                '800 {SIZE}px "Barlow Condensed", sans-serif',
                isLandscape ? 1 : 2
              );
              const subSize = Math.round(u * 0.03);
              const gapBallHead = Math.round(u * 0.03);
              const gapHeadSub = Math.round(u * 0.022);
              const totalGroupH =
                nominalBallD + gapBallHead + measuredHead.totalH + gapHeadSub + subSize;
              const groupTop = Math.round((h - totalGroupH) / 2);

              drawBall3D(
                w / 2 - slowDrift * 0.5,
                groupTop + nominalBallD / 2 - (1 - textExit) * 24,
                stingerBallSize,
                t * 2.6,
                t * 2.05,
                Math.sin(t * 1.5) * 0.4,
                {
                  alpha: clamp01((t - 2.95) / 0.25) * textExit,
                  glowColor: 'rgba(245, 197, 56, 0.36)',
                  camZ: 4.35 - clamp01((t - 2.95) / 1.5) * 0.65,
                }
              );

              ctx.save();
              ctx.globalAlpha = textExit;
              const headRes = drawWrappedBlock(
                ctx,
                statusHeadline,
                w / 2 + slowDrift,
                groupTop + nominalBallD + gapBallHead,
                w * 0.88,
                headBase,
                headMin,
                '800 {SIZE}px "Barlow Condensed", sans-serif',
                textEnter,
                {
                  liftPx: 38,
                  stagger: 0.14,
                  baseColor: '#FFFFFF',
                  shineColor: '#F5C538',
                  shinePhase: t * 0.75,
                  maxLines: isLandscape ? 1 : 2,
                }
              );

              const subA = easeOutCubic(clamp01((t - 3.3) / 0.4)) * textExit;
              ctx.globalAlpha = subA;
              const stingerSubRaw = (
                template === 'upcoming'
                  ? `${tournament?.name || 'SVC'} • ${resolvedScheduleLabel} • ${resolvedCourtLabel}`
                  : `${tournament?.name || 'SVC'} • ${activeMatch?.courtName || 'Arena Utama'}`
              ).toUpperCase();
              const fittedStingerSub = fitSingleLine(
                ctx,
                stingerSubRaw,
                Math.round(w * 0.88),
                subSize,
                Math.round(u * 0.02),
                '700 {SIZE}px "Plus Jakarta Sans", sans-serif'
              );
              ctx.textAlign = 'center';
              ctx.fillStyle = '#F9DC76';
              ctx.font = `700 ${fittedStingerSub.fontSize}px "Plus Jakarta Sans", sans-serif`;
              ctx.fillText(
                fittedStingerSub.text,
                w / 2 + slowDrift * 0.5,
                headRes.bottomY + gapHeadSub + Math.round(fittedStingerSub.fontSize * 0.84)
              );
              ctx.restore();
            }
          }
        }

        drawSafeZoneOverlay();
        return;
      }

      // 2. PURE SCENE 3 MATCHUP (5.25s - 7.60s) — skipped in Daily Schedule & Non-Match modes
      if (t < 7.6) {
        if (skipMatchup) {
          drawPhotoAndScoreboard(Math.max(0, t - 4.4), 1, true, t);
        } else {
          drawScene3Matchup(t, 0);
        }
        drawSafeZoneOverlay();
        return;
      }

      // 3. FLUID SHUTTER-DOOR TRANSITION (7.60s - 8.85s) + ADAPTIVE SCENE 4 HOLD
      const shouldRunOutro = includeOutro && t >= timeline.outroStartSec;
      if (!shouldRunOutro) {
        const elapsedInScene4 = skipMatchup ? Math.max(0, t - 4.4) : Math.max(0, t - 7.6);
        const uiProgress = skipMatchup ? 1 : clamp01((t - 7.78) / 0.92);
        drawPhotoAndScoreboard(elapsedInScene4, uiProgress, true, t);

        if (t < 8.88 && !skipMatchup) {
          const doorSplit = easeFluidCurtain(clamp01((t - 7.6) / 1.22));
          drawScene3Matchup(t, doorSplit);
        }

        drawSafeZoneOverlay();
        return;
      }

      // 4. SMOOTH DIAGONAL GOLD WIPE FROM SCENE 4 -> SCENE 5 OUTRO
      if (t < timeline.outroWipeEndSec) {
        const elapsedInScene4 = skipMatchup ? Math.max(0, t - 4.4) : Math.max(0, t - 7.6);
        drawPhotoAndScoreboard(elapsedInScene4, 1, true, t);

        const wipeP = easeFluidCurtain(
          clamp01((t - timeline.outroStartSec) / 1.08)
        );
        const leadX = -w * 0.45 + wipeP * (w * 2.15);

        // Clip Scene 5 Outro inside the advancing diagonal polygon
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-w * 0.6, 0);
        ctx.lineTo(leadX, 0);
        ctx.lineTo(leadX - w * 0.35, h);
        ctx.lineTo(-w * 0.95, h);
        ctx.closePath();
        ctx.clip();
        drawScene5Outro(t, timeline.outroStartSec);
        ctx.restore();

        // Crisp Golden Broadcast Leading Edge Ribbon
        ctx.save();
        ctx.fillStyle = '#F5C538';
        ctx.beginPath();
        ctx.moveTo(leadX - w * 0.045, 0);
        ctx.lineTo(leadX + w * 0.02, 0);
        ctx.lineTo(leadX - w * 0.33, h);
        ctx.lineTo(leadX - w * 0.395, h);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        drawSafeZoneOverlay();
        return;
      }

      // 5. PURE SCENE 5 OUTRO
      drawScene5Outro(t, timeline.outroStartSec);
      drawSafeZoneOverlay();
    },
    [
      ratio,
      template,
      colorFilter,
      photoCredit,
      photoItems,
      videoClip?.zoom,
      videoClip?.panX,
      videoClip?.panY,
      activeScheduleDay,
      schedulePages,
      safeScheduleSlideIdx,
      bracketTournament,
      bracketMatches,
      bracketTotalRounds,
      bracketFocus,
      totalMainRounds,
      teamMap,
      stageTheme,
      effectiveStageKey,
      stageDisplayBadge,
      stageMeta,
      podiumVariant,
      resolvedPodium1,
      resolvedPodium2,
      resolvedPodium3,
      caption,
      mediaMode,
      posterLayout,
      videoCoverImg,
      timeline.totalDurationSec,
      timeline.scene4HoldSec,
      timeline.outroStartSec,
      timeline.outroWipeEndSec,
      upcomingSchedule,
      upcomingCourt,
      includeIntro,
      includeOutro,
      cleanFrameShowFooter,
      eventMomentBadge,
      eventMomentTitle,
      eventMomentSubtitle,
      venueRulesTitle,
      venueRulesItems,
      announcementBadge,
      announcementTitle,
      announcementBody,
      activeMatch,
      teamA,
      teamB,
      tournament,
      data.settings,
      canvasDragging,
      activeCanvasSlot,
    ]
  );

  const renderFrameRef = useRef(renderFrame);
  renderFrameRef.current = renderFrame;

  const photoUrlsKey = photoItems.map((p) => p.url).join('|');

  // Preload all visual assets (1-3 Photos, SVC, AVERSA, SMANSAGE, Burst Rays, Arcs, Sponsors, Team & Podium Logos)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const teamLogoList = (data.teams ?? []).filter((tm) => Boolean(tm.logoUrl));
      const [
        loadedPhotos,
        mainLogo,
        coLogo,
        organizerLogo,
        burstRays,
        arcsGold,
        sparkles,
        spikerOfficial,
        ballOfficial,
        netOfficial,
        teamALogo,
        teamBLogo,
        podium1Logo,
        podium2Logo,
        podium3Logo,
        loadedTeamLogos,
        ...sponsorImgs
      ] = await Promise.all([
        Promise.all(photoItems.map((it) => loadImage(it.url))),
        loadImage(data.settings?.logoUrl || '/brand/svc-crest-color.svg'),
        loadImage(data.settings?.coBrandLogoUrl || '/brand/aversa-standalone-color.svg'),
        loadImage(data.settings?.organizerLogoUrl || '/brand/logo_smansage.png'),
        loadImage('/brand/magic-burst-rays.svg'),
        loadImage('/brand/watermark-arcs-gold.svg'),
        loadImage('/brand/item-stardust-sparkle-stars.svg'),
        loadImage('/brand/svc-spiker-official.svg'),
        loadImage('/brand/pro-volleyball.svg'),
        loadImage('/brand/svc-net-official.svg'),
        teamA?.logoUrl ? loadImage(teamA.logoUrl) : Promise.resolve(null),
        teamB?.logoUrl ? loadImage(teamB.logoUrl) : Promise.resolve(null),
        resolvedPodium1?.logoUrl ? loadImage(resolvedPodium1.logoUrl) : Promise.resolve(null),
        resolvedPodium2?.logoUrl ? loadImage(resolvedPodium2.logoUrl) : Promise.resolve(null),
        resolvedPodium3?.logoUrl ? loadImage(resolvedPodium3.logoUrl) : Promise.resolve(null),
        Promise.all(
          teamLogoList.map(async (tm) => [tm.id, await loadImage(tm.logoUrl!)] as const)
        ),
        ...sponsorList.map((sp) => loadImage(sp.darkLogoUrl || sp.logoUrl)),
      ]);

      if (cancelled) return;
      const teamLogoMap = new Map<number, HTMLImageElement>();
      for (const [tid, img] of loadedTeamLogos) {
        if (img) teamLogoMap.set(tid, img);
      }
      loadedAssetsRef.current = {
        photos: loadedPhotos.filter((img): img is HTMLImageElement => img !== null),
        mainLogo,
        coLogo,
        organizerLogo,
        burstRays,
        arcsGold,
        sparkles,
        spikerOfficial,
        ballOfficial,
        netOfficial,
        teamALogo,
        teamBLogo,
        podium1Logo,
        podium2Logo,
        podium3Logo,
        teamLogos: teamLogoMap,
        sponsors: sponsorList.map((item, idx) => ({
          item,
          img: sponsorImgs[idx] ?? null,
        })),
      };
      if (!previewPlayingRef.current && !exportingVideoRef.current) {
        renderFrameRef.current(0, false, showSafeZoneRef.current);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    photoUrlsKey,
    data.settings,
    teamA?.logoUrl,
    teamB?.logoUrl,
    resolvedPodium1?.logoUrl,
    resolvedPodium2?.logoUrl,
    resolvedPodium3?.logoUrl,
    sponsorList.length,
  ]);

  const handleAddPhotos = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);
    const currentCount = photoItems.length;
    const slotsLeft = MAX_STUDIO_PHOTOS - currentCount;
    if (slotsLeft <= 0) {
      setStatusMsg(`Maksimal ${MAX_STUDIO_PHOTOS} foto momen per konten.`);
      setTimeout(() => setStatusMsg(null), 3000);
      return;
    }

    const toProcess = incoming.slice(0, slotsLeft);
    setConvertingMedia(true);
    try {
      const normalizedFiles: File[] = [];
      for (const rawFile of toProcess) {
        const clean = await normalizeImageInBrowser(rawFile, {
          maxDimension: 2160,
          onStatus: setStatusMsg,
        });
        normalizedFiles.push(clean);
      }

      setPhotoItems((prev) => {
        const avail = MAX_STUDIO_PHOTOS - prev.length;
        const added = normalizedFiles.slice(0, avail).map((f) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          url: URL.createObjectURL(f),
        }));
        return [...prev, ...added];
      });

      if (incoming.length > slotsLeft) {
        setStatusMsg(`Dipilih ${slotsLeft} foto pertama (maksimal ${MAX_STUDIO_PHOTOS} foto).`);
        setTimeout(() => setStatusMsg(null), 3000);
      } else {
        setStatusMsg(null);
      }
    } catch (err) {
      setStatusMsg(`Gagal memuat foto: ${(err as Error).message}`);
    } finally {
      setConvertingMedia(false);
    }
  };

  const handleMovePhoto = (idx: number, dir: -1 | 1) => {
    setPhotoItems((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      if (moved) copy.splice(target, 0, moved);
      return copy;
    });
  };

  const handleRemovePhoto = (id: string) => {
    setPhotoItems((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter((p) => p.id !== id);
    });
    if (activeFramingKey === id) setActiveFramingKey(null);
  };

  const handleUpdatePhotoFraming = (
    id: string,
    patch: { zoom?: number; panX?: number; panY?: number }
  ) => {
    setPhotoItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  };

  const handleResetPhotoFraming = (id: string) => {
    setPhotoItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, zoom: 1, panX: 0, panY: 0 } : p))
    );
  };

  const hasInteractiveCanvasMedia =
    ((mediaMode === 'photo' && photoItems.length > 0) ||
      (mediaMode === 'video' && Boolean(videoClip))) &&
    !previewPlaying &&
    !exportingVideo &&
    !exportingBatchIg;

  const clampedCanvasSlot =
    mediaMode === 'video'
      ? 0
      : Math.min(activeCanvasSlot, Math.max(0, photoItems.length - 1));

  const getCanvasSlotGeometry = (slotIdxOverride?: number) => {
    const { w, h } = DIMENSIONS[ratio];
    const u = Math.min(w, h);
    const pad = Math.round(u * 0.052);
    const isStory = ratio === '9:16';
    const isLandscape = ratio === '16:9';
    const safeTop = isStory ? Math.round(h * 0.13) : pad;
    const safeBottom = isStory ? Math.round(h * 0.15) : pad;
    const rects =
      mediaMode === 'video'
        ? [{ rx: 0, ry: 0, rw: w, rh: h }]
        : getCollageSlotRects(
            Math.max(1, photoItems.length),
            posterLayout,
            w,
            h,
            safeTop,
            safeBottom,
            u,
            isLandscape
          );
    const idx = Math.min(slotIdxOverride ?? clampedCanvasSlot, rects.length - 1);
    const slotRect = rects[idx] ?? rects[0]!;
    let srcW = 0;
    let srcH = 0;
    if (mediaMode === 'video') {
      const vEl = hiddenVideoRef.current;
      srcW = vEl?.videoWidth
        ? vEl.videoWidth
        : videoCoverImg?.naturalWidth || videoCoverImg?.width || 0;
      srcH = vEl?.videoHeight
        ? vEl.videoHeight
        : videoCoverImg?.naturalHeight || videoCoverImg?.height || 0;
    } else {
      const img = loadedAssetsRef.current.photos[idx];
      srcW = img?.naturalWidth || img?.width || 0;
      srcH = img?.naturalHeight || img?.height || 0;
    }
    const cur: MediaFraming =
      mediaMode === 'video'
        ? {
            zoom: videoClip?.zoom ?? 1,
            panX: videoClip?.panX ?? 0,
            panY: videoClip?.panY ?? 0,
          }
        : {
            zoom: photoItems[idx]?.zoom ?? 1,
            panX: photoItems[idx]?.panX ?? 0,
            panY: photoItems[idx]?.panY ?? 0,
          };
    return { w, h, rects, idx, slotRect, srcW, srcH, cur };
  };

  const commitCanvasSlotFraming = (idx: number, next: MediaFraming) => {
    if (mediaMode === 'video') {
      setVideoClip((prev) =>
        prev ? { ...prev, zoom: next.zoom, panX: next.panX, panY: next.panY } : prev
      );
      return;
    }
    setPhotoItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, zoom: next.zoom, panX: next.panX, panY: next.panY } : it
      )
    );
  };

  const canvasDirectStateRef = useRef({
    interactive: hasInteractiveCanvasMedia,
    getGeometry: getCanvasSlotGeometry,
    commit: commitCanvasSlotFraming,
  });
  canvasDirectStateRef.current = {
    interactive: hasInteractiveCanvasMedia,
    getGeometry: getCanvasSlotGeometry,
    commit: commitCanvasSlotFraming,
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = canvasDirectStateRef.current;
      if (!st.interactive) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const gInit = st.getGeometry(0);
      const cx = ((e.clientX - rect.left) / rect.width) * gInit.w;
      const cy = ((e.clientY - rect.top) / rect.height) * gInit.h;
      const hitIdx = hitTestCollageSlot(gInit.rects, cx, cy);
      setActiveCanvasSlot(hitIdx);
      const g = st.getGeometry(hitIdx);
      const delta = e.ctrlKey ? -e.deltaY * 0.015 : -e.deltaY * 0.0025;
      if (Math.abs(delta) < 0.0001) return;
      const next = applyZoomLevel(
        g.cur,
        g.cur.zoom + delta,
        g.srcW,
        g.srcH,
        g.slotRect.rw,
        g.slotRect.rh
      );
      st.commit(hitIdx, next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const getCanvasTwoPointerMetrics = () => {
    const pts = Array.from(canvasPointersRef.current.values());
    if (pts.length < 2) return null;
    const [p1, p2] = [pts[0]!, pts[1]!];
    return {
      dist: Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y)),
      midX: (p1.x + p2.x) / 2,
      midY: (p1.y + p2.y) / 2,
    };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!hasInteractiveCanvasMedia) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events
    }
    canvasPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const rect = e.currentTarget.getBoundingClientRect();
    const gInit = getCanvasSlotGeometry(0);
    if (canvasPointersRef.current.size === 1 && rect.width > 0 && rect.height > 0) {
      const cx = ((e.clientX - rect.left) / rect.width) * gInit.w;
      const cy = ((e.clientY - rect.top) / rect.height) * gInit.h;
      const hitIdx = hitTestCollageSlot(gInit.rects, cx, cy);
      setActiveCanvasSlot(hitIdx);
      canvasGestureRef.current.slotIdx = hitIdx;
      canvasGestureRef.current.lastX = e.clientX;
      canvasGestureRef.current.lastY = e.clientY;
    } else if (canvasPointersRef.current.size >= 2) {
      const m = getCanvasTwoPointerMetrics();
      if (m) {
        canvasGestureRef.current.pinchDist = m.dist;
        canvasGestureRef.current.pinchMidX = m.midX;
        canvasGestureRef.current.pinchMidY = m.midY;
      }
    }
    setCanvasDragging(true);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasPointersRef.current.has(e.pointerId) || !hasInteractiveCanvasMedia) {
      return;
    }
    canvasPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const slotIdx = canvasGestureRef.current.slotIdx;
    const g = getCanvasSlotGeometry(slotIdx);
    const slotDomW = Math.max(1, g.slotRect.rw * (rect.width / g.w));
    const slotDomH = Math.max(1, g.slotRect.rh * (rect.height / g.h));

    if (canvasPointersRef.current.size >= 2) {
      const m = getCanvasTwoPointerMetrics();
      if (!m) return;
      const scaleRatio = m.dist / Math.max(1, canvasGestureRef.current.pinchDist);
      const zoomed = applyZoomLevel(
        g.cur,
        g.cur.zoom * scaleRatio,
        g.srcW,
        g.srcH,
        g.slotRect.rw,
        g.slotRect.rh
      );
      const panned = applyPanDelta(
        zoomed,
        m.midX - canvasGestureRef.current.pinchMidX,
        m.midY - canvasGestureRef.current.pinchMidY,
        slotDomW,
        slotDomH,
        g.srcW,
        g.srcH,
        g.slotRect.rw,
        g.slotRect.rh
      );
      canvasGestureRef.current.pinchDist = m.dist;
      canvasGestureRef.current.pinchMidX = m.midX;
      canvasGestureRef.current.pinchMidY = m.midY;
      commitCanvasSlotFraming(slotIdx, panned);
      return;
    }

    const dx = e.clientX - canvasGestureRef.current.lastX;
    const dy = e.clientY - canvasGestureRef.current.lastY;
    canvasGestureRef.current.lastX = e.clientX;
    canvasGestureRef.current.lastY = e.clientY;
    const panned = applyPanDelta(
      g.cur,
      dx,
      dy,
      slotDomW,
      slotDomH,
      g.srcW,
      g.srcH,
      g.slotRect.rw,
      g.slotRect.rh
    );
    commitCanvasSlotFraming(slotIdx, panned);
  };

  const handleCanvasPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasPointersRef.current.delete(e.pointerId);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    if (canvasPointersRef.current.size === 1) {
      const remaining = Array.from(canvasPointersRef.current.values())[0]!;
      canvasGestureRef.current.lastX = remaining.x;
      canvasGestureRef.current.lastY = remaining.y;
    } else if (canvasPointersRef.current.size === 0) {
      setCanvasDragging(false);
    }
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!hasInteractiveCanvasMedia) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const gInit = getCanvasSlotGeometry(0);
    const cx = ((e.clientX - rect.left) / rect.width) * gInit.w;
    const cy = ((e.clientY - rect.top) / rect.height) * gInit.h;
    const hitIdx = hitTestCollageSlot(gInit.rects, cx, cy);
    setActiveCanvasSlot(hitIdx);
    commitCanvasSlotFraming(hitIdx, { zoom: 1, panX: 0, panY: 0 });
  };

  const activeCanvasGeom = getCanvasSlotGeometry(clampedCanvasSlot);

  const handleStepActiveCanvasZoom = (delta: number) => {
    const g = getCanvasSlotGeometry(clampedCanvasSlot);
    const next = applyZoomLevel(
      g.cur,
      g.cur.zoom + delta,
      g.srcW,
      g.srcH,
      g.slotRect.rw,
      g.slotRect.rh
    );
    commitCanvasSlotFraming(clampedCanvasSlot, next);
  };

  const handleResetActiveCanvasSlot = () => {
    commitCanvasSlotFraming(clampedCanvasSlot, { zoom: 1, panX: 0, panY: 0 });
  };

  const handleRemoveVideoClip = useCallback(() => {
    setVideoClip((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setVideoCoverImg(null);
  }, []);

  const handleSelectVideoFile = async (file: File) => {
    handleRemoveVideoClip();
    setConvertingMedia(true);
    try {
      const prepared = await prepareVideoInBrowser(file, {
        maxFallbackSeconds: MAX_VIDEO_CLIP_SEC,
        onStatus: setStatusMsg,
      });
      const initialEnd = Number(
        Math.min(prepared.duration || DEFAULT_VIDEO_CLIP_SEC, DEFAULT_VIDEO_CLIP_SEC).toFixed(1)
      );
      setVideoClip({
        url: prepared.url,
        fileName: prepared.fileName,
        duration: prepared.duration || DEFAULT_VIDEO_CLIP_SEC,
        trimStart: 0,
        trimEnd: initialEnd,
        coverTime: Number(Math.min(initialEnd * 0.35, initialEnd).toFixed(1)),
        volume: 0.85,
        muted: false,
        zoom: 1,
        panX: 0,
        panY: 0,
        fileSizeBytes: file.size,
      });
      if (prepared.convertedInBrowser) {
        setStatusMsg('Video .MOV iPhone berhasil dikonversi otomatis di browser!');
        setTimeout(() => setStatusMsg(null), 3500);
      } else {
        setStatusMsg(null);
      }
    } catch (err) {
      setStatusMsg(`Gagal memuat klip video: ${(err as Error).message}`);
    } finally {
      setConvertingMedia(false);
    }
  };

  const syncHiddenVideoAt = useCallback(
    (elapsedSec: number, active: boolean) => {
      const v = hiddenVideoRef.current;
      if (!v || mediaMode !== 'video' || !videoClip) return;

      if (!active) {
        if (!v.paused) v.pause();
        if (!v.seeking && Math.abs(v.currentTime - videoClip.trimStart) > 0.05) {
          v.currentTime = videoClip.trimStart;
        }
        lastVideoResyncAtRef.current = 0;
        return;
      }

      const preStartGate = Math.max(0, timeline.scene4StartSec - 0.12);
      if (elapsedSec < preStartGate) {
        if (!v.paused) v.pause();
        if (!v.seeking && Math.abs(v.currentTime - videoClip.trimStart) > 0.15) {
          v.currentTime = videoClip.trimStart;
        }
        return;
      }

      if (elapsedSec >= timeline.outroWipeEndSec) {
        if (!v.paused) v.pause();
        return;
      }

      const relSec = Math.max(0, elapsedSec - timeline.scene4StartSec);
      const targetSec = Math.min(videoClip.trimEnd, videoClip.trimStart + relSec);
      if (v.ended || targetSec >= videoClip.trimEnd - 0.05) {
        if (!v.paused) v.pause();
        return;
      }
      if (v.paused) {
        v.play().catch(() => {});
      }
      // Avoid aggressive mid-playback seeks that cause infinite keyframe seek loops on >15s clips.
      // Only resync if drift is catastrophic (> 2.5s) with a 2s cooldown.
      const nowMs = performance.now();
      if (
        !v.seeking &&
        Math.abs(v.currentTime - targetSec) > 2.5 &&
        nowMs - lastVideoResyncAtRef.current > 2000
      ) {
        lastVideoResyncAtRef.current = nowMs;
        v.currentTime = targetSec;
      }
    },
    [mediaMode, videoClip, timeline.scene4StartSec, timeline.outroWipeEndSec]
  );

  useEffect(() => {
    if (!previewPlaying && !exportingVideo) {
      renderFrame(0, false, showSafeZone);
    }
  }, [renderFrame, previewPlaying, exportingVideo, showSafeZone]);

  useEffect(() => {
    setExportedVideoBlob(null);
    setExportedVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [
    selectedMatchId,
    ratio,
    template,
    mediaMode,
    photoItems,
    videoClip?.url,
    videoClip?.trimStart,
    videoClip?.trimEnd,
    includeOutro,
  ]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(previewRafRef.current);
      activeAudioStopRef.current?.();
      if (miniAudioRef.current) {
        miniAudioRef.current.pause();
        miniAudioRef.current = null;
      }
    };
  }, []);

  const stopMiniAudio = useCallback(() => {
    if (miniAudioRef.current) {
      miniAudioRef.current.pause();
      miniAudioRef.current.currentTime = 0;
    }
    setMiniAudioPlaying(false);
  }, []);

  const handleToggleMiniAudio = () => {
    if (audioMode === 'none') return;
    if (miniAudioPlaying) {
      stopMiniAudio();
      return;
    }
    if (!miniAudioRef.current) {
      miniAudioRef.current = new Audio();
      miniAudioRef.current.crossOrigin = 'anonymous';
      miniAudioRef.current.onended = () => setMiniAudioPlaying(false);
    }
    miniAudioRef.current.src = toCorsSafeAssetUrl(selectedTrack.url);
    miniAudioRef.current.volume = bgmVolume;
    miniAudioRef.current
      .play()
      .then(() => setMiniAudioPlaying(true))
      .catch(() => setMiniAudioPlaying(false));
  };

  const handleShuffleTrack = () => {
    stopMiniAudio();
    setAudioMode('auto');
    const next = pickSmartRandomTrack(toAudioTarget(template), { excludeId: selectedTrackId });
    setSelectedTrackId(next.id);
  };

  const unlockHiddenVideoGesture = async () => {
    const v = hiddenVideoRef.current;
    if (!v || mediaMode !== 'video' || !videoClip) return;
    try {
      v.muted = true;
      await v.play();
      v.pause();
      v.currentTime = videoClip.trimStart;
    } catch {
      // Ignore if already unlocked
    }
  };

  const startBroadcastAudioSession = useCallback(
    async (mode: 'preview' | 'export') => {
      activeAudioStopRef.current?.();
      stopMiniAudio();

      const totalDur = timeline.totalDurationSec;
      const wantsBgm = audioMode !== 'none' && bgmVolume > 0.01;
      const wantsClipAudio = Boolean(
        mediaMode === 'video' &&
          videoClip &&
          !videoClip.muted &&
          videoClip.volume > 0.01
      );

      if (!wantsBgm && !enableSfx && !wantsClipAudio) {
        return { stream: null as MediaStream | null, stop: () => {} };
      }

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(1, ctx.currentTime);

      const dest = mode === 'export' ? ctx.createMediaStreamDestination() : null;
      if (mode === 'preview') {
        masterGain.connect(ctx.destination);
      } else if (dest) {
        masterGain.connect(dest);
      }

      const startAt = ctx.currentTime + 0.05;

      // 1. Schedule S3 BGM Track with Auto-Ducking during Court Video Clip
      let bgmSrc: AudioBufferSourceNode | null = null;
      if (wantsBgm) {
        try {
          let buf = audioBufferCacheRef.current.get(selectedTrack.url);
          if (!buf) {
            const safeTrackUrl = toCorsSafeAssetUrl(selectedTrack.url);
            const resp = await fetch(safeTrackUrl, { mode: 'cors' });
            if (resp.ok) {
              const arr = await resp.arrayBuffer();
              buf = await ctx.decodeAudioData(arr);
              audioBufferCacheRef.current.set(selectedTrack.url, buf);
            }
          }
          if (buf) {
            bgmSrc = ctx.createBufferSource();
            bgmSrc.buffer = buf;
            bgmSrc.loop = buf.duration < totalDur;

            const bgmGain = ctx.createGain();
            bgmGain.gain.setValueAtTime(0.0001, startAt);
            bgmGain.gain.linearRampToValueAtTime(bgmVolume, startAt + 0.4);

            if (wantsClipAudio) {
              const ducked = Math.max(0.05, bgmVolume * 0.32);
              bgmGain.gain.setValueAtTime(bgmVolume, startAt + 7.4);
              bgmGain.gain.linearRampToValueAtTime(ducked, startAt + 7.8);
              const riseStart = Math.min(totalDur - 1.6, timeline.outroStartSec);
              if (riseStart > 7.9) {
                bgmGain.gain.setValueAtTime(ducked, startAt + riseStart);
                bgmGain.gain.linearRampToValueAtTime(
                  bgmVolume,
                  startAt + Math.min(totalDur - 1.5, riseStart + 0.5)
                );
              }
            }

            bgmGain.gain.setValueAtTime(bgmVolume, startAt + Math.max(0.5, totalDur - 1.5));
            bgmGain.gain.linearRampToValueAtTime(0.0001, startAt + totalDur);

            bgmSrc.connect(bgmGain);
            bgmGain.connect(masterGain);
            bgmSrc.start(startAt);
            bgmSrc.stop(startAt + totalDur + 0.05);
          }
        } catch {
          // Graceful fallback if S3 audio fails to decode/fetch
        }
      }

      // 2. Zero-RAM Streaming Original Court Video Audio (.MOV / .MP4) inside Scene 4
      let clipAudioEl: HTMLVideoElement | null = null;
      let clipPlayTimer = 0;
      let clipStopTimer = 0;
      if (wantsClipAudio && videoClip && typeof ctx.createMediaElementSource === 'function') {
        try {
          clipAudioEl = document.createElement('video');
          clipAudioEl.src = videoClip.url;
          clipAudioEl.playsInline = true;
          clipAudioEl.preload = 'auto';
          clipAudioEl.currentTime = videoClip.trimStart;

          // Unlock element inside current user gesture for iOS Safari WebKit compatibility
          clipAudioEl.muted = true;
          await clipAudioEl.play().catch(() => {});
          clipAudioEl.pause();
          clipAudioEl.muted = false;
          clipAudioEl.currentTime = videoClip.trimStart;

          const mediaNode = ctx.createMediaElementSource(clipAudioEl);
          const clipGain = ctx.createGain();
          const clipStartCtx = startAt + timeline.scene4StartSec;
          const safeSpan = Math.max(0.3, timeline.scene4HoldSec);

          clipGain.gain.setValueAtTime(0.0001, ctx.currentTime);
          clipGain.gain.setValueAtTime(0.0001, clipStartCtx);
          clipGain.gain.linearRampToValueAtTime(videoClip.volume, clipStartCtx + 0.2);
          clipGain.gain.setValueAtTime(
            videoClip.volume,
            clipStartCtx + Math.max(0.22, safeSpan - 0.3)
          );
          clipGain.gain.linearRampToValueAtTime(0.0001, clipStartCtx + safeSpan);

          mediaNode.connect(clipGain);
          clipGain.connect(masterGain);

          const delayStartMs = Math.max(0, Math.round((clipStartCtx - ctx.currentTime) * 1000));
          clipPlayTimer = window.setTimeout(() => {
            if (!clipAudioEl) return;
            clipAudioEl.currentTime = videoClip.trimStart;
            clipAudioEl.play().catch(() => {});
          }, delayStartMs);

          clipStopTimer = window.setTimeout(() => {
            clipAudioEl?.pause();
          }, delayStartMs + Math.round(safeSpan * 1000) + 80);
        } catch {
          clipAudioEl = null;
        }
      }

      // 3. Schedule ReactBits Sound Lab procedural transition SFX (0 KB)
      if (enableSfx) {
        scheduleBroadcastSfx(ctx, masterGain, startAt, {
          includeOutro,
          outroStartSec: timeline.outroStartSec,
          slideTriggerSecs: timeline.slideTriggerSecs,
        });
      }

      const stop = () => {
        if (clipPlayTimer) window.clearTimeout(clipPlayTimer);
        if (clipStopTimer) window.clearTimeout(clipStopTimer);
        if (clipAudioEl) {
          clipAudioEl.pause();
          clipAudioEl.removeAttribute('src');
          clipAudioEl.load();
          clipAudioEl = null;
        }
        try {
          bgmSrc?.stop();
        } catch {
          // Ignore if already stopped
        }
        ctx.close().catch(() => {});
      };

      activeAudioStopRef.current = stop;
      return { stream: dest?.stream ?? null, stop };
    },
    [
      audioMode,
      bgmVolume,
      enableSfx,
      includeOutro,
      mediaMode,
      videoClip,
      timeline.totalDurationSec,
      timeline.scene4HoldSec,
      timeline.outroStartSec,
      timeline.slideTriggerSecs,
      selectedTrack.url,
      stopMiniAudio,
    ]
  );

  // Pre-upload all photo, video, crest, & sponsor textures to GPU VRAM before animation starts
  // so Scene 3 -> Scene 4 (7.60s) never experiences a synchronous bitmap/VRAM upload stall!
  const warmUpGpuTextures = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const a = loadedAssetsRef.current;
    const allImgs: Array<HTMLImageElement | HTMLVideoElement | null | undefined> = [
      ...a.photos,
      videoCoverImg,
      hiddenVideoRef.current && hiddenVideoRef.current.readyState >= 2
        ? hiddenVideoRef.current
        : null,
      a.mainLogo,
      a.coLogo,
      a.organizerLogo,
      a.spikerOfficial,
      a.ballOfficial,
      a.netOfficial,
      a.teamALogo,
      a.teamBLogo,
      a.podium1Logo,
      a.podium2Logo,
      a.podium3Logo,
      ...a.sponsors.map((s) => s.img),
    ];
    ctx.save();
    ctx.globalAlpha = 0.001;
    for (const item of allImgs) {
      if (!item) continue;
      try {
        ctx.drawImage(item, 0, 0, 2, 2);
      } catch {
        // Ignore if not yet ready
      }
    }
    ctx.restore();
  }, [videoCoverImg]);

  const handlePlayPreview = async () => {
    if (previewPlaying || exportingVideo) return;
    previewPlayingRef.current = true;
    setPreviewPlaying(true);
    if (lastVideoFrameCanvasRef.current) {
      lastVideoFrameCanvasRef.current.width = 0;
    }
    await unlockHiddenVideoGesture();
    syncHiddenVideoAt(0, false);
    warmUpGpuTextures();
    renderFrameRef.current(0, true, showSafeZoneRef.current);
    const totalDur = timeline.totalDurationSec;
    const session = await startBroadcastAudioSession('preview');
    const start = performance.now();
    const tick = (now: number) => {
      const elapsedSec = (now - start) / 1000;
      if (elapsedSec <= totalDur) {
        syncHiddenVideoAt(elapsedSec, true);
        renderFrameRef.current(elapsedSec, true, showSafeZoneRef.current);
        previewRafRef.current = requestAnimationFrame(tick);
      } else {
        syncHiddenVideoAt(0, false);
        session.stop();
        previewPlayingRef.current = false;
        setPreviewPlaying(false);
        renderFrameRef.current(0, false, showSafeZoneRef.current);
      }
    };
    previewRafRef.current = requestAnimationFrame(tick);
  };

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderFrame(0, false, false);
    const link = document.createElement('a');
    link.download = `SVC-AVERSA-${teamA?.shortCode || 'MATCH'}-vs-${teamB?.shortCode || 'MATCH'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    renderFrame(0, false, showSafeZone);
  };

  const handleDownloadIgPack = async () => {
    const canvas = canvasRef.current;
    if (!canvas || exportingBatchIg) return;
    setExportingBatchIg(true);
    try {
      const baseSlug =
        template === 'schedule_day'
          ? `JADWAL-${(activeScheduleDay?.dayLabel || 'HARIAN').replace(/[^a-zA-Z0-9]+/g, '-')}`
          : template === 'bracket'
            ? `BAGAN-${(bracketTournament?.name || 'TURNAMEN').replace(/[^a-zA-Z0-9]+/g, '-')}`
            : isNonMatchTemplate(template)
            ? template.toUpperCase().replace(/[^a-zA-Z0-9]+/g, '-')
            : `${teamA?.shortCode || 'TIMA'}-vs-${teamB?.shortCode || 'TIMB'}`;

      renderFrame(0, false, false, '9:16');
      const linkStory = document.createElement('a');
      linkStory.download = `SVC-${baseSlug}_Story_9x16.png`;
      linkStory.href = canvas.toDataURL('image/png');
      linkStory.click();

      await new Promise((r) => window.setTimeout(r, 260));

      renderFrame(0, false, false, '4:5');
      const linkFeed = document.createElement('a');
      linkFeed.download = `SVC-${baseSlug}_Feed_4x5.png`;
      linkFeed.href = canvas.toDataURL('image/png');
      linkFeed.click();

      setStatusMsg('Paket IG (Story 9:16 + Feed 4:5) berhasil diunduh!');
      window.setTimeout(() => setStatusMsg(null), 3500);
    } finally {
      renderFrame(0, false, showSafeZone);
      setExportingBatchIg(false);
    }
  };

  const generatedSocialCaption = useMemo(() => {
    const eventTitle = data.settings?.eventName || 'Smansage Volleyball Competition 2026';
    const subTitle = data.settings?.eventSubtitle || 'AVERSA • Dies Natalis 44 SMAN 1 Gedeg';
    const hashtags = '#SmansageVolleyball2026 #SVC2026 #AVERSA #SMAN1Gedeg #VoliPelajar';
    const creditLine = photoCredit.trim() ? `\n\n📸 ${photoCredit.trim()}` : '';
    const noteLine = caption.trim() ? `\n${caption.trim()}` : '';

    if (template === 'schedule_day') {
      const dayTitle = activeScheduleDay?.dayLabel || 'Hari Ini';
      const lines = (activeScheduleDay?.items ?? []).slice(0, 8).map(({ match: dm, parsed }) => {
        const tA = dm.teamAId ? teamMap.get(dm.teamAId)?.name || 'TBD' : 'TBD';
        const tB = dm.teamBId ? teamMap.get(dm.teamBId)?.name || 'TBD' : 'TBD';
        const rawTime = parsed.timeLabel || dm.courtName;
        return `• ${rawTime} | ${tA} vs ${tB}`;
      });
      return `📅 JADWAL PERTANDINGAN — ${dayTitle.toUpperCase()}\n${eventTitle} (${tournament?.name || 'Umum'})\n\n${lines.join('\n') || 'Jadwal segera diperbarui.'}${noteLine}${creditLine}\n\n${hashtags}`;
    }

    if (template === 'bracket') {
      const catName = bracketTournament?.name || tournament?.name || 'Turnamen';
      const focusDesc =
        bracketFocus === 'left'
          ? 'Bagan Kiri (Pool A)'
          : bracketFocus === 'right'
            ? 'Bagan Kanan (Pool B)'
            : bracketFocus === 'finals'
              ? 'Grand Final & Perebutan Juara 3'
              : bracketFocus === 'full'
                ? 'Bagan Lengkap'
                : 'Tur Bagan Lengkap (Pool A → Pool B → Grand Final)';
      return `🏆 BAGAN GUGUR (${catName.toUpperCase()}) — ${eventTitle}\n📌 ${focusDesc}${noteLine}${creditLine}\n\n${subTitle}\n${hashtags}`;
    }

    if (template === 'clean_frame') {
      return `📸 ${eventTitle}${noteLine}${creditLine}\n\n${subTitle}\n${hashtags}`;
    }

    if (template === 'event_moment') {
      const badgeStr = (eventMomentBadge.trim() || 'MOMEN SPESIAL').toUpperCase();
      const titleStr = eventMomentTitle.trim() || eventTitle;
      const subStr = eventMomentSubtitle.trim() ? `\n📍 ${eventMomentSubtitle.trim()}` : '';
      return `✨ ${badgeStr} — ${titleStr}${subStr}${noteLine}${creditLine}\n\n${subTitle}\n${hashtags}`;
    }

    if (template === 'venue_rules') {
      const rulesHdr = (venueRulesTitle.trim() || 'TATA TERTIB & LARANGAN ARENA').toUpperCase();
      const rulesList = venueRulesItems
        .map((r, i) => (r.trim() ? `${i + 1}. ${r.trim()}` : ''))
        .filter(Boolean)
        .join('\n');
      return `⚠️ ${rulesHdr}\n${eventTitle}\n\n${rulesList}${noteLine}${creditLine}\n\n${subTitle}\n${hashtags}`;
    }

    if (template === 'announcement') {
      const annHdr = (announcementBadge.trim() || 'PENGUMUMAN').toUpperCase();
      const annTtl = announcementTitle.trim() || eventTitle;
      const annTxt = announcementBody.trim();
      return `📢 ${annHdr}: ${annTtl}\n\n${annTxt}${noteLine}${creditLine}\n\n${subTitle}\n${hashtags}`;
    }

    if (template === 'champion') {
      const winnerTitle =
        podiumVariant === 'podium_all'
          ? `1st: ${resolvedPodium1?.name || '-'}\n2nd: ${resolvedPodium2?.name || '-'}\n3rd: ${resolvedPodium3?.name || '-'}`
          : podiumVariant === 'runner_up'
            ? `🥈 Runner-Up (2nd Place): ${resolvedPodium2?.name || '-'}`
            : podiumVariant === 'third_place'
              ? `🥉 3rd Place: ${resolvedPodium3?.name || '-'}`
              : `🏆 CHAMPIONS (1st Place): ${resolvedPodium1?.name || '-'}`;
      return `🏆 HASIL AKHIR ${tournament?.name || ''} — ${eventTitle}\n\n${winnerTitle}${noteLine}${creditLine}\n\n${subTitle}\n${hashtags}`;
    }

    const nameA = teamA?.name || 'Tim A';
    const nameB = teamB?.name || 'Tim B';
    const stageStr = activeMatch ? formatInternationalStageLabel(activeMatch, totalMainRounds) : stageDisplayBadge;
    const courtStr = activeMatch?.courtName || upcomingCourt || 'Lapangan Utama';
    const playedSets = (activeMatch?.sets ?? [])
      .filter((s) => s.scoreA > 0 || s.scoreB > 0)
      .map((s) => `${s.scoreA}-${s.scoreB}`)
      .join(' | ');
    const scoreLine =
      template === 'upcoming'
        ? `⏰ ${upcomingSchedule || activeMatch?.scheduledAt || 'Segera Bertanding'} • 📍 ${courtStr}`
        : `🏐 Skor Set: ${activeMatch?.setsWonA ?? 0} - ${activeMatch?.setsWonB ?? 0}${playedSets ? ` (${playedSets})` : ''} • 📍 ${courtStr}`;

    return `🔥 ${stageStr.toUpperCase()} — ${eventTitle}\n${nameA} vs ${nameB}\n${scoreLine}${noteLine}${creditLine}\n\n${subTitle}\n${hashtags}`;
  }, [
    data.settings?.eventName,
    data.settings?.eventSubtitle,
    photoCredit,
    caption,
    template,
    activeScheduleDay,
    bracketTournament?.name,
    bracketFocus,
    tournament?.name,
    teamMap,
    podiumVariant,
    resolvedPodium1,
    resolvedPodium2,
    resolvedPodium3,
    teamA?.name,
    teamB?.name,
    activeMatch,
    totalMainRounds,
    stageDisplayBadge,
    upcomingCourt,
    upcomingSchedule,
  ]);

  const handleExportVideo = async () => {
    const canvas = canvasRef.current;
    if (!canvas || exportingVideo) return;
    exportingVideoRef.current = true;
    previewPlayingRef.current = false;
    setExportingVideo(true);
    setPreviewPlaying(false);
    cancelAnimationFrame(previewRafRef.current);
    if (lastVideoFrameCanvasRef.current) {
      lastVideoFrameCanvasRef.current.width = 0;
    }
    setVideoProgress(0);
    await unlockHiddenVideoGesture();
    syncHiddenVideoAt(0, false);
    warmUpGpuTextures();
    renderFrameRef.current(0, true, false);

    try {
      const totalDur = timeline.totalDurationSec;
      const videoStream = canvas.captureStream(30);
      const audioSession = await startBroadcastAudioSession('export');
      const combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...(audioSession.stream ? audioSession.stream.getAudioTracks() : []),
      ]);

      const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
        ? 'video/mp4;codecs=avc1'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const durationMs = totalDur * 1000;
      const startTime = performance.now();

      recorder.onstop = async () => {
        syncHiddenVideoAt(0, false);
        audioSession.stop();
        const rawExt = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const rawBlob = new Blob(chunks, { type: mimeType });

        let finalBlob = rawBlob;
        let finalExt: 'mp4' | 'webm' = rawExt;
        try {
          setStatusMsg('Mengoptimalkan format MP4 (H.264 + AAC + FastStart) untuk Instagram/TikTok/WA...');
          finalBlob = await transcodeToSocialMp4(rawBlob, (msg) => setStatusMsg(msg));
          finalExt = 'mp4';
        } catch (convErr) {
          console.warn('Social MP4 transcode fallback to raw MediaRecorder blob:', convErr);
        }

        const url = URL.createObjectURL(finalBlob);
        setExportedVideoBlob(finalBlob);
        setExportedVideoUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setExportedVideoExt(finalExt);
        exportingVideoRef.current = false;
        setExportingVideo(false);
        setVideoProgress(0);
        renderFrameRef.current(0, false, showSafeZoneRef.current);
        setStatusMsg(
          `Video broadcast ${totalDur} detik (.${finalExt.toUpperCase()}) siap diunggah ke Sosmed!`
        );
        setTimeout(() => setStatusMsg(null), 5000);
      };

      recorder.start();

      let lastPct = -1;
      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const curSec = progress * totalDur;
        syncHiddenVideoAt(curSec, true);
        renderFrameRef.current(curSec, true, false);
        const nextPct = Math.round(progress * 100);
        if (nextPct !== lastPct) {
          lastPct = nextPct;
          setVideoProgress(nextPct);
        }
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          recorder.stop();
        }
      };

      requestAnimationFrame(animate);
    } catch (err) {
      syncHiddenVideoAt(0, false);
      exportingVideoRef.current = false;
      setExportingVideo(false);
      setStatusMsg(`Gagal export video: ${(err as Error).message}`);
    }
  };

  const handlePublish = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !activeMatch || publishing) return;
    setPublishing(true);
    try {
      renderFrame(0, false, false);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      renderFrame(0, false, showSafeZone);
      if (!blob) throw new Error('Gagal memproses gambar poster');

      const fd = new FormData();
      fd.append('file', new File([blob], `report-${Date.now()}.png`, { type: 'image/png' }));
      fd.append('matchId', String(activeMatch.id));
      fd.append('caption', caption.trim());

      // Attach Broadcast Video or Trimmed Video Clip when available (<= 45MB)
      let attachedVideo = false;
      if (exportedVideoBlob && exportedVideoBlob.size <= 45 * 1024 * 1024) {
        fd.append(
          'video',
          new File(
            [exportedVideoBlob],
            `broadcast-${Date.now()}.${exportedVideoExt}`,
            { type: exportedVideoBlob.type || `video/${exportedVideoExt}` }
          )
        );
        attachedVideo = true;
      } else if (mediaMode === 'video' && videoClip) {
        try {
          const clipResp = await fetch(videoClip.url);
          const clipBlob = await clipResp.blob();
          if (clipBlob.size > 0 && clipBlob.size <= 45 * 1024 * 1024) {
            const clipExt = videoClip.fileName.toLowerCase().endsWith('.webm')
              ? 'webm'
              : videoClip.fileName.toLowerCase().endsWith('.mov')
                ? 'mov'
                : 'mp4';
            fd.append(
              'video',
              new File([clipBlob], `clip-${Date.now()}.${clipExt}`, {
                type: clipBlob.type || 'video/mp4',
              })
            );
            attachedVideo = true;
          }
        } catch {
          // Proceed with cover poster if raw clip blob is unreachable
        }
      }

      // Attach individual high-resolution slide photos when multi-photo (2-3) is active
      let attachedSlideCount = 0;
      if (mediaMode === 'photo' && photoItems.length > 1) {
        for (let i = 0; i < photoItems.length; i++) {
          const item = photoItems[i]!;
          const slideResp = await fetch(item.url);
          const slideBlob = await slideResp.blob();
          const ext = slideBlob.type === 'image/png' ? 'png' : 'jpg';
          fd.append(
            'slides',
            new File([slideBlob], `slide-${Date.now()}-${i + 1}.${ext}`, {
              type: slideBlob.type || 'image/jpeg',
            })
          );
          attachedSlideCount++;
        }
      }

      const activeSet = activeMatch.sets.find(
        (s) => s.setNumber === activeMatch.currentSet
      );
      const scoreText =
        template === 'champion'
          ? podiumVariant === 'runner_up'
            ? '2nd Place • Runner-Up'
            : podiumVariant === 'third_place'
              ? '3rd Place Winner'
              : podiumVariant === 'podium_all'
                ? 'Official Podium 1-2-3'
                : '1st Place • Champions'
          : template === 'schedule_day'
            ? `Jadwal • ${activeScheduleDay?.dayLabel || 'Hari Ini'}`
            : activeMatch.status === 'live' && activeSet
              ? `${stageDisplayBadge} • Set ${activeMatch.currentSet}: ${activeSet.scoreA}-${activeSet.scoreB}`
              : `${stageDisplayBadge} • Final ${activeMatch.setsWonA}-${activeMatch.setsWonB}`;

      fd.append(
        'scoreSnapshot',
        JSON.stringify({
          teamA:
            template === 'champion'
              ? resolvedPodium1?.shortCode || '1ST'
              : teamA?.shortCode || 'A',
          teamB:
            template === 'champion'
              ? resolvedPodium2?.shortCode || '2ND'
              : teamB?.shortCode || 'B',
          scoreText,
        })
      );

      await apiFetch('/api/media/reports', { method: 'POST', body: fd });
      await onRefresh();

      const summary = attachedVideo
        ? 'Video & Poster berhasil dipublish ke Galeri Momen!'
        : attachedSlideCount > 0
          ? `Slide Galeri (${attachedSlideCount} Foto + Poster) berhasil dipublish!`
          : 'Poster Live Report berhasil dipublish ke Galeri Momen!';
      setStatusMsg(summary);
      setTimeout(() => setStatusMsg(null), 4500);
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const handleDeleteReport = async (reportId: number) => {
    if (deletingReportId) return;
    setDeletingReportId(reportId);
    try {
      await apiFetch(`/api/media/reports/${reportId}`, { method: 'DELETE' });
      await onRefresh();
      setStatusMsg('Unggahan Galeri Momen berhasil dihapus.');
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setDeletingReportId(null);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_420px]">
      {/* Hidden offscreen video decoder synced to Scene 4 when mediaMode === 'video' */}
      {videoClip && (
        <video
          ref={hiddenVideoRef}
          src={videoClip.url}
          muted
          playsInline
          preload="auto"
          className="hidden"
        />
      )}

      {/* Guided 3-Step Wizard Column */}
      <div className="space-y-4">
        {statusMsg && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
            {statusMsg}
          </div>
        )}

        {/* Default-closed Quick Guide Accordion */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setShowGuideAccordion((prev) => !prev)}
            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60"
          >
            <span className="inline-flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              Panduan Cepat (3 Langkah)
            </span>
            <ChevronDown
              className={`h-4 w-4 text-slate-400 transition-transform ${showGuideAccordion ? 'rotate-180' : ''}`}
            />
          </button>
          {showGuideAccordion && (
            <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
              <ol className="list-inside list-decimal space-y-1">
                <li>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">Match &amp; Media:</span> Pilih pertandingan (atau hari jadwal), lalu unggah 1–3 foto (JPG/PNG/HEIC) atau potong klip video ala trimmer.
                </li>
                <li>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">Format &amp; Teks:</span> Pilih template, filter warna, rasio, serta caption/kredit dan musik latar.
                </li>
                <li>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">Preview &amp; Export:</span> Unduh PNG, Paket IG (9:16 + 4:5), video 3D/transisi, atau terbitkan ke Galeri &amp; Publik.
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Stepper Header */}
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
          {(
            [
              [1, '1. Match & Media'],
              [2, '2. Format & Teks'],
              [3, '3. Preview & Export'],
            ] as const
          ).map(([num, label]) => (
            <button
              key={num}
              type="button"
              onClick={() => setStep(num)}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold transition ${
                step === num
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {step > num && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Step Content Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {step === 1 && (
            <div className="animate-page-enter space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Camera className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                  <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                    Langkah 1: Match &amp; Media
                  </h2>
                  <InfoTooltip text="Pilih pertandingan (atau hari jadwal di Langkah 2), lalu unggah 1–3 foto atau 1 klip video." />
                </div>
              </div>

              {isNonMatchTemplate(template) ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5">
                  <div>
                    <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      Mode Umum / Non-Pertandingan
                    </div>
                    <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      Template ini tidak terhubung ke jadwal maupun skor pertandingan.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setTemplate(
                        activeMatch?.status === 'live'
                          ? 'live'
                          : activeMatch?.status === 'finished'
                            ? 'final'
                            : 'upcoming'
                      )
                    }
                    className="rounded-lg border border-emerald-600/30 bg-white px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-50 dark:bg-slate-900 dark:text-emerald-300"
                  >
                    Kembali ke Match
                  </button>
                </div>
              ) : template === 'bracket' ? (
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      <Trophy className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      Kategori Bagan Turnamen
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setTemplate(
                          activeMatch?.status === 'live'
                            ? 'live'
                            : activeMatch?.status === 'finished'
                              ? 'final'
                              : 'upcoming'
                        )
                      }
                      className="text-[11px] font-bold text-amber-700 hover:underline dark:text-amber-400"
                    >
                      Pilih per Match
                    </button>
                  </div>
                  <select
                    value={bracketTournament?.id ?? ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        setSelectedBracketTournamentId(Number(e.target.value));
                      }
                    }}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                  >
                    {data.tournaments.length === 0 && (
                      <option value="">Belum ada kategori turnamen</option>
                    )}
                    {data.tournaments.map((tItem) => (
                      <option key={tItem.id} value={tItem.id}>
                        {tItem.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : template === 'schedule_day' ? (
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      <CalendarDays className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      Hari Jadwal
                    </label>
                    <button
                      type="button"
                      onClick={() => setTemplate(activeMatch?.status === 'live' ? 'live' : activeMatch?.status === 'finished' ? 'final' : 'upcoming')}
                      className="text-[11px] font-bold text-amber-700 hover:underline dark:text-amber-400"
                    >
                      Pilih per Match
                    </button>
                  </div>
                  <select
                    value={safeScheduleDayIdx}
                    onChange={(e) => setSelectedScheduleDayIdx(Number(e.target.value))}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                  >
                    {scheduleDayGroups.length === 0 && (
                      <option value={0}>Belum ada jadwal hari</option>
                    )}
                    {scheduleDayGroups.map((grp, gIdx) => (
                      <option key={grp.dayKey} value={gIdx}>
                        Hari {gIdx + 1}: {grp.dayLabel} ({grp.items.length} pertandingan)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      Pertandingan
                    </label>
                    {scheduleDayGroups.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setTemplate('schedule_day')}
                        className="text-[11px] font-bold text-amber-700 hover:underline dark:text-amber-400"
                      >
                        Mode Jadwal Harian →
                      </button>
                    )}
                  </div>
                  <select
                    value={activeMatch?.id ?? ''}
                    onChange={(e) => setSelectedMatchId(Number(e.target.value))}
                    className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                  >
                    {playableMatches.length === 0 && (
                      <option value="">Belum ada pertandingan</option>
                    )}
                    {playableMatches.map((m) => {
                      const tA = m.teamAId ? teamMap.get(m.teamAId)?.name : 'TBD';
                      const tB = m.teamBId ? teamMap.get(m.teamBId)?.name : 'TBD';
                      const mRounds = data.matches
                        .filter(
                          (x) =>
                            x.tournamentId === m.tournamentId &&
                            x.bracketType === 'main'
                        )
                        .map((x) => x.round);
                      const mTotal = mRounds.length > 0 ? Math.max(...mRounds) : 3;
                      const stageLbl = formatInternationalStageLabel(m, mTotal);
                      const st =
                        m.status === 'live'
                          ? 'LIVE'
                          : m.status === 'finished'
                            ? 'FINAL'
                            : 'UPCOMING';
                      return (
                        <option key={m.id} value={m.id}>
                          [{st}] {stageLbl} • {tA} vs {tB} ({m.courtName})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Media Source Mode Selector: Multi-Photo (1-3) vs Single Video + Cut */}
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Sumber Media
                  </label>
                  <InfoTooltip text="Foto mendukung 1–3 gambar (kolase & slideshow); Klip Video mendukung trimmer ala WhatsApp maks 60 detik." />
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-950">
                  <button
                    type="button"
                    onClick={() => setMediaMode('photo')}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${
                      mediaMode === 'photo'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-amber-300'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                    }`}
                  >
                    <ImagePlus className="h-4 w-4 shrink-0" />
                    Foto (1–{MAX_STUDIO_PHOTOS})
                  </button>
                  <button
                    type="button"
                    onClick={() => setMediaMode('video')}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${
                      mediaMode === 'video'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-amber-300'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                    }`}
                  >
                    <Video className="h-4 w-4 shrink-0" />
                    Klip Video (Cut)
                  </button>
                </div>
              </div>

              {mediaMode === 'photo' ? (
                <div className="space-y-3">
                  {photoItems.length < MAX_STUDIO_PHOTOS && (
                    <label
                      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm font-semibold text-slate-700 transition hover:border-amber-600 hover:text-amber-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-amber-400 dark:hover:text-amber-300 ${
                        convertingMedia ? 'pointer-events-none opacity-60' : ''
                      }`}
                    >
                      <ImagePlus className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                      <span>
                        {convertingMedia
                          ? 'Mengonversi foto di browser...'
                          : photoItems.length === 0
                            ? `Pilih 1–${MAX_STUDIO_PHOTOS} Foto`
                            : `Tambah Foto (${photoItems.length}/${MAX_STUDIO_PHOTOS})`}
                      </span>
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                        JPG, PNG, WebP, HEIC iPhone
                      </span>
                      <input
                        type="file"
                        accept={IMAGE_INPUT_ACCEPT}
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          handleAddPhotos(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}

                  {photoItems.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                          Foto Terpilih ({photoItems.length}/{MAX_STUDIO_PHOTOS})
                          <InfoTooltip text="Foto #1 dipakai sebagai cover utama. Klik ikon Crop pada foto atau langsung geser & pinch di Live Preview." />
                        </span>
                        <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-400">
                          Durasi {timeline.totalDurationSec}s
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2.5">
                        {photoItems.map((item, idx) => {
                          const hasCustomFraming =
                            (item.zoom ?? 1) > 1.01 ||
                            Math.abs(item.panX ?? 0) > 0.01 ||
                            Math.abs(item.panY ?? 0) > 0.01;
                          const isFramingOpen = activeFramingKey === item.id;
                          return (
                            <div
                              key={item.id}
                              className={`overflow-hidden rounded-xl border bg-slate-950 ${
                                isFramingOpen
                                  ? 'border-sky-500 ring-1 ring-sky-500/40'
                                  : idx === 0
                                    ? 'border-amber-500 ring-1 ring-amber-500/40'
                                    : 'border-slate-200 dark:border-slate-800'
                              }`}
                            >
                              <div className="relative aspect-[4/3]">
                                <img
                                  src={item.url}
                                  alt={`Foto ${idx + 1}`}
                                  className="h-full w-full object-cover"
                                />
                                <span className="absolute left-1.5 top-1.5 rounded bg-slate-950/85 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-300">
                                  {idx === 0 ? '#1' : `#${idx + 1}`}
                                </span>
                              </div>
                              <div className="flex items-center justify-between bg-white px-1 py-1 dark:bg-slate-900">
                                <div className="flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => handleMovePhoto(idx, -1)}
                                    aria-label="Geser foto ke kiri"
                                    className="inline-flex min-h-8 min-w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
                                  >
                                    <ArrowLeft className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === photoItems.length - 1}
                                    onClick={() => handleMovePhoto(idx, 1)}
                                    aria-label="Geser foto ke kanan"
                                    className="inline-flex min-h-8 min-w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
                                  >
                                    <ArrowRight className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <div className="flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveCanvasSlot(idx);
                                      setActiveFramingKey((cur) =>
                                        cur === item.id ? null : item.id
                                      );
                                    }}
                                    aria-label="Crop dan atur posisi foto"
                                    title="Crop & Geser Posisi"
                                    className={`inline-flex min-h-8 min-w-7 items-center justify-center rounded transition ${
                                      isFramingOpen || hasCustomFraming
                                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                    }`}
                                  >
                                    <Crop className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePhoto(item.id)}
                                    aria-label="Hapus foto"
                                    className="inline-flex min-h-8 min-w-7 items-center justify-center rounded text-red-600 hover:bg-red-500/10 dark:text-red-400"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {(() => {
                        const activeIdx = photoItems.findIndex(
                          (p) => p.id === activeFramingKey
                        );
                        if (activeIdx === -1) return null;
                        const activePhoto = photoItems[activeIdx]!;
                        const slotGeom = getCanvasSlotGeometry(activeIdx);
                        const slotAspect =
                          slotGeom.slotRect.rw / Math.max(1, slotGeom.slotRect.rh);
                        return (
                          <MediaCropBox
                            title={`Crop Foto #${activeIdx + 1}`}
                            imageUrl={activePhoto.url}
                            aspectRatio={slotAspect}
                            zoom={activePhoto.zoom ?? 1}
                            panX={activePhoto.panX ?? 0}
                            panY={activePhoto.panY ?? 0}
                            cssFilter={COLOR_FILTER_MAP[colorFilter]?.css}
                            onChange={(next) =>
                              handleUpdatePhotoFraming(activePhoto.id, next)
                            }
                            onReset={() => handleResetPhotoFraming(activePhoto.id)}
                            onClose={() => setActiveFramingKey(null)}
                          />
                        );
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {!videoClip ? (
                    <label
                      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center text-sm font-semibold text-slate-700 transition hover:border-amber-600 hover:text-amber-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-amber-400 dark:hover:text-amber-300 ${
                        convertingMedia ? 'pointer-events-none opacity-60' : ''
                      }`}
                    >
                      <Video className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                      <span>
                        {convertingMedia
                          ? 'Menyiapkan video di browser...'
                          : 'Pilih 1 Klip Video'}
                      </span>
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                        MOV iPhone &amp; MP4 • Cut maks {MAX_VIDEO_CLIP_SEC}s
                      </span>
                      <input
                        type="file"
                        accept={VIDEO_INPUT_ACCEPT}
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleSelectVideoFile(f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  ) : (
                    <>
                      <VideoTrimmerControl
                        clip={videoClip}
                        onChange={setVideoClip}
                        onCaptureCover={(img) => setVideoCoverImg(img)}
                        onRemove={handleRemoveVideoClip}
                      />
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveFramingKey((cur) =>
                              cur === 'video' ? null : 'video'
                            )
                          }
                          className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100/70 dark:text-slate-200 dark:hover:bg-slate-900"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Crop className="h-3.5 w-3.5 text-amber-500" />
                            Crop &amp; Posisi Video
                          </span>
                          <ChevronDown
                            className={`h-4 w-4 text-slate-400 transition-transform ${
                              activeFramingKey === 'video' ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                        {activeFramingKey === 'video' && (
                          <div className="border-t border-slate-200 p-2 dark:border-slate-800">
                            <MediaCropBox
                              title="Crop & Posisi Video"
                              imageUrl={videoCoverImg?.src ?? null}
                              aspectRatio={
                                DIMENSIONS[ratio].w / DIMENSIONS[ratio].h
                              }
                              zoom={videoClip.zoom ?? 1}
                              panX={videoClip.panX ?? 0}
                              panY={videoClip.panY ?? 0}
                              cssFilter={COLOR_FILTER_MAP[colorFilter]?.css}
                              onChange={(next) =>
                                setVideoClip((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        zoom: next.zoom,
                                        panX: next.panX,
                                        panY: next.panY,
                                      }
                                    : prev
                                )
                              }
                              onReset={() =>
                                setVideoClip((prev) =>
                                  prev
                                    ? { ...prev, zoom: 1, panX: 0, panY: 0 }
                                    : prev
                                )
                              }
                              onClose={() => setActiveFramingKey(null)}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  Lanjut ke Langkah 2
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-page-enter space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                  Langkah 2: Format, Gaya &amp; Caption
                </h2>
                <InfoTooltip text="Pilih template siaran, rasio konten, filter warna, caption/kredit, dan musik latar." />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Template Siaran
                    </label>
                    <InfoTooltip text="Sesuaikan layout grafis overlay dengan momen: Live, Final, Jadwal Harian, Highlight, atau Podium Juara." />
                  </div>
                  <div className="grid gap-1.5">
                    {(
                      [
                        ['live', 'LIVE MATCH'],
                        ['final', 'FINAL SCORE'],
                        ['upcoming', 'UPCOMING MATCH'],
                        ['highlight', 'MATCH HIGHLIGHT'],
                        ['schedule_day', 'JADWAL HARIAN'],
                        ['bracket', 'BAGAN / BRACKET'],
                        ['champion', 'CHAMPIONS & PODIUM'],
                      ] as const
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setTemplate(val)}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${
                          template === val
                            ? val === 'champion'
                              ? 'border-amber-500 bg-gradient-to-r from-amber-500/20 to-yellow-500/10 text-amber-700 ring-1 ring-amber-500/40 dark:text-amber-300'
                              : 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span>{label}</span>
                        {val === 'champion' && (
                          <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        )}
                        {val === 'schedule_day' && (
                          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                        )}
                        {val === 'bracket' && (
                          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="mb-1.5 mt-3 flex items-center gap-1.5">
                    <label className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                      Umum / Non-Pertandingan (Bebas Jadwal)
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        ['clean_frame', 'FRAME POLOS'],
                        ['event_moment', 'CEREMONY / BOOTH'],
                        ['venue_rules', 'TATA TERTIB'],
                        ['announcement', 'PENGUMUMAN'],
                      ] as const
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setTemplate(val)}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${
                          template === val
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Aspect Ratio
                    </label>
                    <InfoTooltip text="9:16 untuk IG Story/Reels/TikTok, 4:5 untuk Feed IG, 1:1 untuk kotak, 16:9 untuk YouTube/TV." />
                  </div>
                  <div className="grid gap-1.5">
                    {(Object.keys(DIMENSIONS) as AspectRatio[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRatio(r)}
                        className={`rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${
                          ratio === r
                            ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800'
                        }`}
                      >
                        {DIMENSIONS[r].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Conditional Template Theme Box: Champion Podium OR Daily Schedule Day Selector OR Stage Badge */}
              {template === 'champion' ? (
                <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      <Trophy className="h-4 w-4" />
                      Podium &amp; Juara
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {tournament?.name}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['champion_1', '1st Place • Champion', Crown],
                        ['runner_up', '2nd Place • Runner-Up', Medal],
                        ['third_place', '3rd Place Winner', Medal],
                        ['podium_all', 'Official Podium (1-2-3)', Trophy],
                      ] as const
                    ).map(([vKey, vLabel, IconComp]) => (
                      <button
                        key={vKey}
                        type="button"
                        onClick={() => {
                          setPodiumVariant(vKey);
                          setCustomSpotlightTeamId(null);
                        }}
                        className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${
                          podiumVariant === vKey
                            ? 'border-amber-500 bg-white text-amber-900 shadow-xs dark:bg-slate-900 dark:text-amber-300'
                            : 'border-slate-200/80 bg-white/60 text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300'
                        }`}
                      >
                        <IconComp className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span className="truncate">{vLabel}</span>
                      </button>
                    ))}
                  </div>

                  {podiumVariant !== 'podium_all' && (
                    <div>
                      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                        Spotlight Tim
                      </label>
                      <select
                        value={customSpotlightTeamId ?? ''}
                        onChange={(e) =>
                          setCustomSpotlightTeamId(
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="">
                          Auto-Detect (
                          {(podiumVariant === 'runner_up'
                            ? autoRunnerUpTeam?.name
                            : podiumVariant === 'third_place'
                              ? autoThirdTeam?.name
                              : autoChampionTeam?.name) || 'TBD'}
                          )
                        </option>
                        {catTeams.map((tm) => (
                          <option key={tm.id} value={tm.id}>
                            {tm.name} {tm.school ? `(${tm.school})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : template === 'bracket' ? (
                <div className="space-y-2.5 rounded-2xl border border-amber-500/35 bg-amber-500/8 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      <LayoutGrid className="h-4 w-4" />
                      Fokus Bagan / Tur Kamera
                      <InfoTooltip text="Mode Auto Tour akan menggerakkan kamera sinematik secara berurutan dari Bagan Kiri (Pool A) → Bagan Kanan (Pool B) → Grand Final & Juara 3 saat mode Video/Preview." />
                    </span>
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-800 dark:text-amber-300">
                      {bracketTournament?.name || 'Turnamen'} • {bracketMatches.length} Match
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['auto_tour', 'Auto Tour 3-Babak'],
                        ['left', 'Kiri (Pool A)'],
                        ['right', 'Kanan (Pool B)'],
                        ['finals', 'Grand Final'],
                        ['full', 'Full Overview'],
                      ] as const
                    ).map(([fKey, fLabel]) => (
                      <button
                        key={fKey}
                        type="button"
                        onClick={() => setBracketFocus(fKey)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                          bracketFocus === fKey
                            ? 'border-amber-500 bg-amber-500 text-slate-950 shadow-xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-amber-500/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {fLabel}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Tips: Anda bisa langsung export PNG/IG Pack/Video MP4 tanpa mengunggah foto/video (otomatis memakai arena navy-gold animatif).
                  </p>
                </div>
              ) : template === 'schedule_day' ? (
                <div className="space-y-2.5 rounded-2xl border border-sky-500/35 bg-sky-500/8 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                      <CalendarDays className="h-4 w-4" />
                      Pilih Hari Jadwal
                      <InfoTooltip text="Menampilkan maksimal 4 pertandingan per slide (dengan logo tim) agar rapi. Dalam mode Video, slide berganti otomatis." />
                    </span>
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-sky-700 dark:text-sky-300">
                      {activeScheduleDay
                        ? `${activeScheduleDay.dayLabel} • ${activeScheduleDay.items.length} Match`
                        : 'Belum ada jadwal'}
                    </span>
                  </div>
                  {scheduleDayGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {scheduleDayGroups.map((grp, gIdx) => (
                        <button
                          key={grp.dayKey}
                          type="button"
                          onClick={() => {
                            setSelectedScheduleDayIdx(gIdx);
                            setScheduleSlideIdx(0);
                          }}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                            safeScheduleDayIdx === gIdx
                              ? 'border-sky-500 bg-sky-500 text-slate-950 shadow-xs'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-sky-500/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                          }`}
                        >
                          Hari {gIdx + 1}: {grp.dayLabel} ({grp.items.length})
                        </button>
                      ))}
                    </div>
                  )}
                  {schedulePages.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-sky-500/20 pt-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                        Slide ({schedulePages.length}):
                      </span>
                      {schedulePages.map((pg, pIdx) => (
                        <button
                          key={pIdx}
                          type="button"
                          onClick={() => setScheduleSlideIdx(pIdx)}
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                            safeScheduleSlideIdx === pIdx
                              ? 'border-amber-500 bg-amber-400 text-slate-950'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-amber-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                          }`}
                        >
                          Slide {pIdx + 1} ({pg.length} Match)
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : template === 'clean_frame' ? (
                <div className="space-y-2 rounded-2xl border border-emerald-500/35 bg-emerald-500/8 p-3.5">
                  <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    Pengaturan Frame Polos
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={cleanFrameShowFooter}
                      onChange={(e) => setCleanFrameShowFooter(e.target.checked)}
                    />
                    <span>Tampilkan Strip Nama Acara / Catatan di Bawah</span>
                  </label>
                </div>
              ) : template === 'event_moment' ? (
                <div className="space-y-2.5 rounded-2xl border border-emerald-500/35 bg-emerald-500/8 p-3.5">
                  <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    Ceremony / Booth / Sponsor Speech
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'OPENING CEREMONY',
                      'SPONSOR SPEECH',
                      'BOOTH BAZAR',
                      'SPONSOR SPOTLIGHT',
                      'CLOSING CEREMONY',
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setEventMomentBadge(preset)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                          eventMomentBadge === preset
                            ? 'border-amber-500 bg-amber-400 text-slate-950'
                            : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      value={eventMomentBadge}
                      onChange={(e) => setEventMomentBadge(e.target.value)}
                      placeholder="Lencana Atas (mis. SPONSOR SPEECH)"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                    />
                    <input
                      type="text"
                      value={eventMomentTitle}
                      onChange={(e) => setEventMomentTitle(e.target.value)}
                      placeholder="Judul Utama / Nama Pembicara / Brand"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <input
                    type="text"
                    value={eventMomentSubtitle}
                    onChange={(e) => setEventMomentSubtitle(e.target.value)}
                    placeholder="Subjudul / Jabatan / Lokasi Booth"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              ) : template === 'venue_rules' ? (
                <div className="space-y-2.5 rounded-2xl border border-red-500/35 bg-red-500/8 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-red-700 dark:text-red-300">
                      Tata Tertib &amp; Larangan Penonton
                    </span>
                    {venueRulesItems.length < 6 && (
                      <button
                        type="button"
                        onClick={() =>
                          setVenueRulesItems((prev) => [...prev, 'Patuhi arahan panitia di arena.'])
                        }
                        className="rounded-lg border border-red-500/30 bg-white px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50 dark:bg-slate-900 dark:text-red-300"
                      >
                        + Tambah Poin
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={venueRulesTitle}
                    onChange={(e) => setVenueRulesTitle(e.target.value)}
                    placeholder="Judul Kartu Peraturan"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                  />
                  <div className="space-y-1.5">
                    {venueRulesItems.map((rule, rIdx) => (
                      <div key={rIdx} className="flex items-center gap-1.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-red-600 text-[11px] font-extrabold text-white">
                          {rIdx + 1}
                        </span>
                        <input
                          type="text"
                          value={rule}
                          onChange={(e) =>
                            setVenueRulesItems((prev) =>
                              prev.map((it, idx) => (idx === rIdx ? e.target.value : it))
                            )
                          }
                          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                        />
                        {venueRulesItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setVenueRulesItems((prev) => prev.filter((_, idx) => idx !== rIdx))
                            }
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-600 hover:text-red-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                            title="Hapus poin"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : template === 'announcement' ? (
                <div className="space-y-2.5 rounded-2xl border border-sky-500/35 bg-sky-500/8 p-3.5">
                  <div className="text-xs font-extrabold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                    Pengumuman / Info Cepat
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'PENGUMUMAN',
                      'OPEN GATE TRIBUN',
                      'INFO TIKET & PARKIR',
                      'LIVE STREAMING ON AIR',
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAnnouncementBadge(preset)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                          announcementBadge === preset
                            ? 'border-sky-500 bg-sky-500 text-slate-950'
                            : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      value={announcementBadge}
                      onChange={(e) => setAnnouncementBadge(e.target.value)}
                      placeholder="Lencana (mis. PENGUMUMAN)"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                    />
                    <input
                      type="text"
                      value={announcementTitle}
                      onChange={(e) => setAnnouncementTitle(e.target.value)}
                      placeholder="Judul Pengumuman"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <textarea
                    rows={2}
                    value={announcementBody}
                    onChange={(e) => setAnnouncementBody(e.target.value)}
                    placeholder="Tulis isi pengumuman singkat..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              ) : (
                <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                      Lencana Babak
                      <InfoTooltip text="Otomatis mendeteksi babak dari bagan atau pilih manual (Pool, R16, QF, SF, 3rd, Final)." />
                    </span>
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-800 dark:text-amber-300">
                      {stageDisplayBadge}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['auto', 'Auto'],
                        ['pool', 'Pool'],
                        ['r16', 'R16'],
                        ['qf', 'QF'],
                        ['sf', 'Semi-Final'],
                        ['third', '3rd Place'],
                        ['final', 'Grand Final'],
                      ] as const
                    ).map(([sKey, sLabel]) => (
                      <button
                        key={sKey}
                        type="button"
                        onClick={() => setStageTheme(sKey)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                          stageTheme === sKey
                            ? 'border-amber-500 bg-amber-500 text-slate-950 shadow-xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-amber-500/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {sLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Color Filter Presets */}
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    Filter Warna
                  </span>
                  <InfoTooltip text="Preset gradasi warna instan pada foto maupun klip video di canvas export." />
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(Object.keys(COLOR_FILTER_MAP) as ColorFilterPreset[]).map(
                    (fKey) => (
                      <button
                        key={fKey}
                        type="button"
                        onClick={() => setColorFilter(fKey)}
                        className={`rounded-xl border px-2.5 py-2 text-xs font-bold transition ${
                          colorFilter === fKey
                            ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {COLOR_FILTER_MAP[fKey].label}
                      </button>
                    )
                  )}
                </div>
              </div>

              {mediaMode === 'photo' && photoItems.length >= 2 && template !== 'schedule_day' && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/8 p-3.5">
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Layout Poster PNG ({photoItems.length} Foto)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPosterLayout('collage')}
                      className={`min-h-10 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                        posterLayout === 'collage'
                          ? 'border-amber-500 bg-white text-amber-800 shadow-xs dark:bg-slate-900 dark:text-amber-300'
                          : 'border-slate-200 text-slate-600 hover:bg-white/60 dark:border-slate-800 dark:text-slate-400'
                      }`}
                    >
                      Kolase Grid ({photoItems.length} Foto)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPosterLayout('single')}
                      className={`min-h-10 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                        posterLayout === 'single'
                          ? 'border-amber-500 bg-white text-amber-800 shadow-xs dark:bg-slate-900 dark:text-amber-300'
                          : 'border-slate-200 text-slate-600 hover:bg-white/60 dark:border-slate-800 dark:text-slate-400'
                      }`}
                    >
                      1 Foto Utama (#1)
                    </button>
                  </div>
                </div>
              )}

              {template === 'upcoming' && (
                <div className="grid gap-3 rounded-2xl border border-sky-500/35 bg-sky-500/8 p-3.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                      Jadwal Tanding
                    </label>
                    <input
                      type="text"
                      value={upcomingSchedule}
                      onChange={(e) => setUpcomingSchedule(e.target.value)}
                      placeholder="Contoh: Sabtu, 09:00 WIB"
                      className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                      Lapangan
                    </label>
                    <input
                      type="text"
                      value={upcomingCourt}
                      onChange={(e) => setUpcomingCourt(e.target.value)}
                      placeholder="Contoh: Court 1"
                      className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Caption Singkat
                  </label>
                  <input
                    type="text"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Contoh: Spike keras penentu Set 2!"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Kredit Foto / Video
                    </label>
                    <InfoTooltip text="Opsional. Nama/akun fotografer atau videografer yang muncul sebagai kredit kecil pada poster." />
                  </div>
                  <input
                    type="text"
                    value={photoCredit}
                    onChange={(e) => setPhotoCredit(e.target.value)}
                    placeholder="Contoh: @timmedia.svc"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              {/* Smart Auto-First BGM & ReactBits SFX Controls */}
              <div className="space-y-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Music className="h-4 w-4 text-amber-500" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                      Musik &amp; SFX
                    </span>
                    <InfoTooltip text="Lagu dipilih otomatis sesuai template. Klik Dengar untuk pratinjau atau Pilih Manual." />
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-600 dark:text-amber-400">
                      {audioMode === 'auto'
                        ? 'Auto'
                        : audioMode === 'manual'
                          ? 'Manual'
                          : 'Mute'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleShuffleTrack}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-600 transition hover:bg-amber-500/10 dark:bg-slate-900 dark:text-amber-400"
                      title="Acak lagu lain"
                    >
                      <Shuffle className="h-3 w-3" />
                      Acak
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        stopMiniAudio();
                        setAudioMode((m) => (m === 'manual' ? 'auto' : 'manual'));
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      {audioMode === 'manual' ? 'Auto' : 'Manual'}
                    </button>
                  </div>
                </div>

                {audioMode !== 'none' && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-900 dark:text-white">
                        {selectedTrack.title}
                      </p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {selectedTrack.vibe} • {selectedTrack.bpm} BPM
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleMiniAudio}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-[11px] font-extrabold text-slate-950 transition hover:bg-amber-400"
                    >
                      {miniAudioPlaying ? (
                        <>
                          <Square className="h-3 w-3 fill-current" />
                          Stop
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3 fill-current" />
                          Dengar
                        </>
                      )}
                    </button>
                  </div>
                )}

                {audioMode === 'manual' && (
                  <div className="space-y-2 pt-1">
                    <select
                      value={selectedTrackId}
                      onChange={(e) => {
                        stopMiniAudio();
                        if (e.target.value === '__none__') {
                          setAudioMode('none');
                        } else {
                          setSelectedTrackId(e.target.value);
                        }
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                    >
                      <optgroup label="Rekomendasi Template Ini">
                        {recommendedTracks.map((tr) => (
                          <option key={tr.id} value={tr.id}>
                            {tr.title} • {tr.vibe} ({tr.bpm} BPM)
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Koleksi Lainnya (18 Lagu)">
                        {otherTracks.map((tr) => (
                          <option key={tr.id} value={tr.id}>
                            {tr.title} • {tr.vibe} ({tr.bpm} BPM)
                          </option>
                        ))}
                      </optgroup>
                      <option value="__none__">Tanpa Musik Latar (Bisu)</option>
                    </select>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <label className="flex items-center gap-2">
                    {bgmVolume === 0 || audioMode === 'none' ? (
                      <VolumeX className="h-3.5 w-3.5 text-slate-400" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    <span>Vol {Math.round(bgmVolume * 100)}%</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={bgmVolume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setBgmVolume(v);
                        if (miniAudioRef.current) miniAudioRef.current.volume = v;
                      }}
                      className="h-1.5 w-20 accent-amber-500"
                    />
                  </label>

                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={enableSfx}
                      onChange={(e) => setEnableSfx(e.target.checked)}
                    />
                    <span>SFX Transisi</span>
                  </label>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold dark:border-slate-800 dark:bg-slate-950">
                  <input
                    type="checkbox"
                    checked={includeIntro}
                    onChange={(e) => setIncludeIntro(e.target.checked)}
                  />
                  <span>Intro Pembuka 3D</span>
                  <InfoTooltip text="Matikan jika ingin video ber-frame langsung tanpa animasi pembuka." />
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold dark:border-slate-800 dark:bg-slate-950">
                  <input
                    type="checkbox"
                    checked={includeOutro}
                    onChange={(e) => setIncludeOutro(e.target.checked)}
                  />
                  <span>
                    Outro Sponsor ({sponsorList.length} logo)
                  </span>
                  <InfoTooltip text="Tambahkan layar penutup logo SVC/AVERSA dan seluruh logo sponsor di akhir video." />
                </label>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold dark:border-slate-700"
                >
                  ← Kembali
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  Lanjut ke Preview &amp; Export
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-page-enter space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                    Langkah 3: Preview, Export &amp; Publish
                  </h2>
                  <InfoTooltip text="Putar animasi 3D, unduh PNG atau Paket IG (9:16 + 4:5), render video broadcast, lalu salin caption atau publish ke Galeri." />
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px]">
                  <ShinyText className="font-bold">
                    {timeline.totalDurationSec}s • 3D Motion
                  </ShinyText>
                  <InfoTooltip
                    align="right"
                    text={`Alur: Intro SVC 3D → Ribbon Stinger → ${
                      template === 'schedule_day'
                        ? activeScheduleDay?.dayLabel || 'Jadwal Harian'
                        : template === 'bracket'
                          ? `Bagan ${bracketTournament?.name || 'Turnamen'}`
                          : `${teamA?.shortCode || 'TIM A'} vs ${teamB?.shortCode || 'TIM B'}`
                    } → ${
                      template === 'bracket'
                        ? bracketFocus === 'auto_tour'
                          ? 'Tur Kamera 3-Babak (Pool A → Pool B → Final)'
                          : 'Tampilan Bagan'
                        : mediaMode === 'video'
                          ? 'Klip Video + Skor'
                          : photoItems.length >= 2
                            ? `${photoItems.length} Foto Momen + Skor`
                            : 'Foto + Skor'
                    }${includeOutro ? ' → Sponsor & Penyelenggara' : ''}`}
                  />
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={previewPlaying || exportingVideo}
                  onClick={handlePlayPreview}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-xs font-bold text-amber-800 transition hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
                >
                  <Play className="h-4 w-4" />
                  {previewPlaying
                    ? 'Memutar Preview...'
                    : `Putar Preview (${timeline.totalDurationSec}s)`}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPng}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-xs font-bold text-slate-900 transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <Download className="h-4 w-4" />
                  {mediaMode === 'video'
                    ? 'Export Cover (PNG)'
                    : photoItems.length >= 2 && posterLayout === 'collage' && template !== 'schedule_day'
                      ? `Export Kolase ${photoItems.length} Foto (PNG)`
                      : 'Export Poster (PNG)'}
                </button>

                <button
                  type="button"
                  disabled={exportingBatchIg || exportingVideo}
                  onClick={handleDownloadIgPack}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-xs font-bold text-sky-800 transition hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-300"
                >
                  <LayoutGrid className="h-4 w-4" />
                  {exportingBatchIg
                    ? 'Menyiapkan Paket IG...'
                    : 'Unduh Paket IG (9:16 + 4:5)'}
                </button>

                <button
                  type="button"
                  disabled={exportingVideo}
                  onClick={handleExportVideo}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-bold text-amber-400 transition hover:bg-slate-800 disabled:opacity-60 dark:bg-amber-500/20 dark:ring-1 dark:ring-amber-500/40"
                >
                  <Film className="h-4 w-4" />
                  {exportingVideo
                    ? `Merender ${videoProgress}%...`
                    : `Export Video (${timeline.totalDurationSec}s)`}
                </button>

                <button
                  type="button"
                  disabled={publishing || !activeMatch || isNonMatchTemplate(template)}
                  onClick={handlePublish}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-50 sm:col-span-2"
                >
                  <Send className="h-4 w-4" />
                  {isNonMatchTemplate(template)
                    ? 'Mode Non-Pertandingan (Gunakan Unduh PNG / Paket IG / Video MP4)'
                    : publishing
                      ? 'Mengunggah ke Galeri...'
                      : exportedVideoBlob
                        ? 'Publish Video Broadcast & Poster'
                        : mediaMode === 'video' && videoClip
                          ? 'Publish Video Klip & Poster'
                          : mediaMode === 'photo' && photoItems.length > 1
                            ? `Publish Slide (${photoItems.length} Foto + Poster)`
                            : 'Publish ke Galeri Momen'}
                </button>
              </div>

              {/* Auto-Caption & Hashtag Social Media Generator */}
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    Caption Sosmed Siap Posting
                    <InfoTooltip text="Dibuat otomatis dari data pertandingan atau jadwal, catatan, kredit media, dan tagar resmi turnamen." />
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(generatedSocialCaption);
                        setCopiedSocialCaption(true);
                        window.setTimeout(() => setCopiedSocialCaption(false), 2000);
                      } catch {
                        setStatusMsg('Gagal menyalin otomatis. Silakan blok & salin teks caption.');
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                      copiedSocialCaption
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                    }`}
                  >
                    {copiedSocialCaption ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Tersalin
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Salin Caption
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  readOnly
                  rows={4}
                  value={generatedSocialCaption}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                />
              </div>

              <div className="flex justify-start pt-1">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold dark:border-slate-700"
                >
                  ← Ubah Format
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live Canvas & Video Player Column */}
      <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex w-full flex-wrap items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          <span className="flex items-center gap-1.5">
            <Camera className="h-4 w-4 text-amber-500" />
            Live Preview ({ratio})
          </span>
          <div className="flex items-center gap-2">
            {ratio === '9:16' && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowSafeZone((v) => !v)}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition ${
                    showSafeZone
                      ? 'border-amber-500/50 bg-amber-500/15 text-amber-500'
                      : 'border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400'
                  }`}
                >
                  {showSafeZone ? 'Safe Zone IG: ON' : 'Safe Zone IG: OFF'}
                </button>
                <InfoTooltip
                  align="right"
                  text="Garis bantu area aman IG Story agar teks tidak terpotong UI Instagram (tidak ikut ter-export)."
                />
              </div>
            )}
            <span>
              {DIMENSIONS[ratio].w}×{DIMENSIONS[ratio].h}
            </span>
          </div>
        </div>

        <div
          ref={canvasWrapRef}
          className="flex w-full items-center justify-center overflow-hidden rounded-xl bg-slate-950 p-2"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerEnd}
            onPointerCancel={handleCanvasPointerEnd}
            onDoubleClick={handleCanvasDoubleClick}
            className={`max-h-[520px] max-w-full rounded-lg object-contain shadow-xl ${
              hasInteractiveCanvasMedia
                ? 'touch-none select-none cursor-grab active:cursor-grabbing'
                : ''
            }`}
          />
        </div>

        {hasInteractiveCanvasMedia && (
          <div className="mt-2.5 flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
              <Move className="h-3.5 w-3.5 text-amber-500" />
              <span>Geser &amp; Pinch/Scroll</span>
              <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-300">
                {mediaMode === 'video' ? 'Video' : `Foto #${clampedCanvasSlot + 1}`}
              </span>
            </span>

            <div className="flex items-center gap-1.5">
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  disabled={activeCanvasGeom.cur.zoom <= 1}
                  onClick={() => handleStepActiveCanvasZoom(-0.2)}
                  aria-label="Perkecil zoom preview"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-10 text-center font-mono text-[11px] font-bold text-slate-800 tabular-nums dark:text-amber-300">
                  {activeCanvasGeom.cur.zoom.toFixed(1)}x
                </span>
                <button
                  type="button"
                  disabled={activeCanvasGeom.cur.zoom >= 3}
                  onClick={() => handleStepActiveCanvasZoom(0.2)}
                  aria-label="Perbesar zoom preview"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={handleResetActiveCanvasSlot}
                aria-label="Reset zoom dan posisi preview"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            </div>
          </div>
        )}

        {exportedVideoUrl && (
          <div className="mt-4 w-full space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-500">
                <Film className="h-3.5 w-3.5" />
                Hasil Video Broadcast ({exportedVideoExt.toUpperCase()})
              </span>
              <a
                href={exportedVideoUrl}
                download={`SVC-AVERSA-BROADCAST-${Date.now()}.${exportedVideoExt}`}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400"
              >
                <Download className="h-3.5 w-3.5" />
                Unduh Video
              </a>
            </div>
            <video
              src={exportedVideoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="max-h-[380px] w-full rounded-lg bg-black object-contain"
            />
          </div>
        )}
      </div>

      {/* Published Gallery Management Panel (Multi-Slide & Video Preview + Delete) */}
      {data.reports.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-display text-base font-extrabold uppercase tracking-wider">
              <LayoutGrid className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              Galeri Momen Terpublikasi ({data.reports.length})
              <InfoTooltip text="Mendukung geser multi-slide foto dan pemutar video langsung di Portal Publik maupun Rincian Pertandingan." />
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.reports.slice(0, 9).map((rep) => (
              <GalleryMediaCard
                key={rep.id}
                report={rep}
                compact
                onDelete={handleDeleteReport}
                deleting={deletingReportId === rep.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

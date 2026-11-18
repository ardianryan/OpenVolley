import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronRight,
  Crown,
  Download,
  Film,
  ImagePlus,
  LayoutGrid,
  Medal,
  Music,
  Play,
  Send,
  Shuffle,
  Square,
  Trash2,
  Trophy,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUDIO_TRACKS,
  getTracksForTemplate,
  pickSmartRandomTrack,
} from '../../shared/audio-library';
import {
  STAGE_VISUAL_META,
  detectMatchStageKey,
  formatInternationalStageLabel,
  type StagePresetKey,
} from '../../shared/stages';
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
type TemplateStyle = 'live' | 'final' | 'upcoming' | 'highlight' | 'champion';
type StageSelection = 'auto' | StagePresetKey;
type PodiumVariant = 'champion_1' | 'runner_up' | 'third_place' | 'podium_all';
type StudioStep = 1 | 2 | 3;

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
  const [stageTheme, setStageTheme] = useState<StageSelection>('auto');
  const [podiumVariant, setPodiumVariant] = useState<PodiumVariant>('champion_1');
  const [customSpotlightTeamId, setCustomSpotlightTeamId] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [includeOutro, setIncludeOutro] = useState(true);
  const [showSafeZone, setShowSafeZone] = useState(true);

  // Multi-Photo (1-3) & Single Trimmed Video Clip State
  const [mediaMode, setMediaMode] = useState<StudioMediaMode>('photo');
  const [photoItems, setPhotoItems] = useState<Array<{ id: string; url: string }>>([]);
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
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewRafRef = useRef<number>(0);
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
    includeOutro,
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

  // Auto-sync template style & match schedule/court with selected match (preserve 'champion' if user chose it)
  useEffect(() => {
    if (!activeMatch) return;
    setTemplate((prev) => {
      if (prev === 'champion') return 'champion';
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

    setSelectedTrackId((prev) =>
      pickSmartRandomTrack(template, {
        excludeId: prev,
        isHighStakes: isFinalRound || isTightScore,
      }).id
    );
  }, [audioMode, template, activeMatch?.id]);

  const selectedTrack =
    AUDIO_TRACKS.find((t) => t.id === selectedTrackId) ?? AUDIO_TRACKS[0];
  const recommendedTracks = getTracksForTemplate(template);
  const recommendedIdSet = new Set(recommendedTracks.map((t) => t.id));
  const otherTracks = AUDIO_TRACKS.filter((t) => !recommendedIdSet.has(t.id));
  const teamMap = new Map<number, Team>(data.teams.map((t) => [t.id, t]));
  const teamA = activeMatch?.teamAId ? teamMap.get(activeMatch.teamAId) : null;
  const teamB = activeMatch?.teamBId ? teamMap.get(activeMatch.teamBId) : null;
  const tournament =
    data.tournaments.find((t) => t.id === activeMatch?.tournamentId) ??
    data.tournaments[0];

  const catMatches = data.matches.filter((m) => m.tournamentId === tournament?.id);
  const catTeams = data.teams.filter((t) => t.tournamentId === tournament?.id);
  const mainRoundNums = catMatches
    .filter((m) => m.bracketType === 'main')
    .map((m) => m.round);
  const totalMainRounds =
    mainRoundNums.length > 0 ? Math.max(...mainRoundNums) : 3;

  const effectiveStageKey: StagePresetKey =
    stageTheme === 'auto'
      ? detectMatchStageKey(activeMatch, totalMainRounds)
      : stageTheme;
  const stageMeta = STAGE_VISUAL_META[effectiveStageKey];
  const stageDisplayBadge =
    effectiveStageKey === 'pool' && activeMatch?.poolName
      ? `POOL ${activeMatch.poolName.toUpperCase()}`
      : stageMeta.badge;

  // Auto-resolve Podium Winners (1st Champion, 2nd Runner-Up, 3rd Place) for active category
  const grandFinalMatch = catMatches.find(
    (m) => m.bracketType === 'main' && m.round === totalMainRounds
  );
  const thirdPlaceMatchObj = catMatches.find((m) => m.bracketType === 'third_place');

  const autoChampionTeam = grandFinalMatch?.winnerId
    ? teamMap.get(grandFinalMatch.winnerId) ?? null
    : activeMatch?.winnerId
      ? teamMap.get(activeMatch.winnerId) ?? null
      : teamA ?? catTeams[0] ?? null;

  const autoRunnerUpTeam =
    grandFinalMatch?.winnerId && grandFinalMatch.teamAId && grandFinalMatch.teamBId
      ? teamMap.get(
          grandFinalMatch.winnerId === grandFinalMatch.teamAId
            ? grandFinalMatch.teamBId
            : grandFinalMatch.teamAId
        ) ?? null
      : teamB ?? catTeams[1] ?? null;

  const autoThirdTeam = thirdPlaceMatchObj?.winnerId
    ? teamMap.get(thirdPlaceMatchObj.winnerId) ?? null
    : thirdPlaceMatchObj?.teamAId
      ? teamMap.get(thirdPlaceMatchObj.teamAId) ?? null
      : catTeams[2] ?? null;

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
    (timeSec: number, isVideo: boolean, drawGuides = false) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { w, h } = DIMENSIONS[ratio];
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const assets = loadedAssetsRef.current;
      const u = Math.min(w, h); // Consistent 1080 base unit across 9:16, 4:5, 16:9, & 1:1
      const pad = Math.round(u * 0.052);
      const isStory = ratio === '9:16';
      const isPost45 = ratio === '4:5';
      const isLandscape = ratio === '16:9';
      const isSquare = ratio === '1:1';
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
        if (!drawGuides || !isStory) return;
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
        source: HTMLImageElement | HTMLVideoElement,
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

        const srcAspect = srcW / srcH;
        const rectAspect = rw / rh;
        let dw = rw;
        let dh = rh;
        if (srcAspect > rectAspect) {
          dh = rh * zoom;
          dw = dh * srcAspect;
        } else {
          dw = rw * zoom;
          dh = dw / srcAspect;
        }
        ctx.drawImage(
          source,
          rx + (rw - dw) / 2 + panX,
          ry + (rh - dh) / 2 + panY,
          dw,
          dh
        );
        ctx.restore();
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
            animSlide && vidEl && vidEl.readyState >= 2 && vidEl.videoWidth > 0;
          const vidSource = canDrawLiveVideo ? vidEl : videoCoverImg;

          if (vidSource) {
            const settle = animSlide
              ? 1 - easeOutQuint(clamp01(elapsedInScene4 / 1.15))
              : 0;
            const breathe = animSlide
              ? 1.03 -
                0.03 * clamp01(elapsedInScene4 / Math.max(1, timeline.scene4HoldSec)) +
                settle * 0.055
              : 1;
            drawMediaCoverRect(vidSource, 0, 0, w, h, breathe, 0, 0);
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
          ctx.fillStyle = '#94A3B8';
          ctx.font = `bold ${Math.round(u * 0.034)}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('Unggah 1 - 3 Foto di Langkah 1', w / 2, h / 2);
        } else if (!animSlide && validPhotos.length >= 2 && posterLayout === 'collage') {
          // Static Poster Collage Grid (2 or 3 Photos with Crisp Golden Broadcast Dividers)
          const visTop = safeTop + Math.round(u * 0.105);
          const visBot = h - safeBottom - Math.round(u * 0.27);
          ctx.save();
          if (validPhotos.length === 2) {
            if (isLandscape) {
              const splitX = Math.round(w * 0.5);
              drawMediaCoverRect(validPhotos[0]!, 0, 0, splitX, h);
              drawMediaCoverRect(validPhotos[1]!, splitX, 0, w - splitX, h);
              ctx.strokeStyle = '#F5C538';
              ctx.lineWidth = Math.max(4, Math.round(u * 0.0045));
              ctx.beginPath();
              ctx.moveTo(splitX, 0);
              ctx.lineTo(splitX, h);
              ctx.stroke();
            } else {
              const splitY = Math.round((visTop + visBot) / 2);
              drawMediaCoverRect(validPhotos[0]!, 0, 0, w, splitY);
              drawMediaCoverRect(validPhotos[1]!, 0, splitY, w, h - splitY);
              ctx.strokeStyle = '#F5C538';
              ctx.lineWidth = Math.max(4, Math.round(u * 0.0045));
              ctx.beginPath();
              ctx.moveTo(0, splitY);
              ctx.lineTo(w, splitY);
              ctx.stroke();
            }
          } else {
            // 3-Photo Broadcast Editorial Grid
            if (isLandscape) {
              const splitX = Math.round(w * 0.56);
              const splitY = Math.round(h * 0.5);
              drawMediaCoverRect(validPhotos[0]!, 0, 0, splitX, h);
              drawMediaCoverRect(validPhotos[1]!, splitX, 0, w - splitX, splitY);
              drawMediaCoverRect(validPhotos[2]!, splitX, splitY, w - splitX, h - splitY);
              ctx.strokeStyle = '#F5C538';
              ctx.lineWidth = Math.max(4, Math.round(u * 0.0045));
              ctx.beginPath();
              ctx.moveTo(splitX, 0);
              ctx.lineTo(splitX, h);
              ctx.moveTo(splitX, splitY);
              ctx.lineTo(w, splitY);
              ctx.stroke();
            } else {
              const splitY = Math.round(visTop + (visBot - visTop) * 0.54);
              const splitX = Math.round(w * 0.5);
              drawMediaCoverRect(validPhotos[0]!, 0, 0, w, splitY);
              drawMediaCoverRect(validPhotos[1]!, 0, splitY, splitX, h - splitY);
              drawMediaCoverRect(validPhotos[2]!, splitX, splitY, w - splitX, h - splitY);
              ctx.strokeStyle = '#F5C538';
              ctx.lineWidth = Math.max(4, Math.round(u * 0.0045));
              ctx.beginPath();
              ctx.moveTo(0, splitY);
              ctx.lineTo(w, splitY);
              ctx.moveTo(splitX, splitY);
              ctx.lineTo(splitX, h);
              ctx.stroke();
            }
          }
          ctx.restore();
        } else if (!animSlide) {
          // Single Hero Cover Photo
          drawMediaCoverRect(validPhotos[0]!, 0, 0, w, h, 1, 0, 0);
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
          drawMediaCoverRect(curImg, 0, 0, w, h, kbCur.zoom, kbCur.panX, kbCur.panY);

          if (slide.nextIdx !== null && slide.wipeProgress > 0) {
            const nextImg = validPhotos[slide.nextIdx];
            if (nextImg) {
              const kbNext = computeKenBurnsTransform(slide.nextIdx, slide.localProgressNext);
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
              drawMediaCoverRect(nextImg, 0, 0, w, h, kbNext.zoom, kbNext.panX, kbNext.panY);
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

        // Scoreboard / Championship Coronation Card: Sized strictly from `u` & `boxH`
        const cardT = animSlide ? clamp01((uiProgress - 0.08) / 0.85) : 1;
        if (cardT <= 0.001) return;

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

      // 1. INTRO & STINGER WIPES (0.0s - 5.25s)
      if (t < 5.25) {
        if (t < 4.4) {
          drawScene1Intro(t);
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

      // 2. PURE SCENE 3 MATCHUP (5.25s - 7.60s)
      if (t < 7.6) {
        drawScene3Matchup(t, 0);
        drawSafeZoneOverlay();
        return;
      }

      // 3. FLUID SHUTTER-DOOR TRANSITION (7.60s - 8.85s) + ADAPTIVE SCENE 4 HOLD
      const shouldRunOutro = includeOutro && t >= timeline.outroStartSec;
      if (!shouldRunOutro) {
        const elapsedInScene4 = Math.max(0, t - 7.6);
        const uiProgress = clamp01((t - 7.78) / 0.92);
        drawPhotoAndScoreboard(elapsedInScene4, uiProgress, true, t);

        if (t < 8.88) {
          const doorSplit = easeFluidCurtain(clamp01((t - 7.6) / 1.22));
          drawScene3Matchup(t, doorSplit);
        }

        drawSafeZoneOverlay();
        return;
      }

      // 4. SMOOTH DIAGONAL GOLD WIPE FROM SCENE 4 -> SCENE 5 OUTRO
      if (t < timeline.outroWipeEndSec) {
        const elapsedInScene4 = Math.max(0, t - 7.6);
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
      includeOutro,
      activeMatch,
      teamA,
      teamB,
      tournament,
      data.settings,
    ]
  );

  const photoUrlsKey = photoItems.map((p) => p.url).join('|');

  // Preload all visual assets (1-3 Photos, SVC, AVERSA, SMANSAGE, Burst Rays, Arcs, Sponsors, Team & Podium Logos)
  useEffect(() => {
    let cancelled = false;
    (async () => {
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
        ...sponsorList.map((sp) => loadImage(sp.darkLogoUrl || sp.logoUrl)),
      ]);

      if (cancelled) return;
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
        sponsors: sponsorList.map((item, idx) => ({
          item,
          img: sponsorImgs[idx] ?? null,
        })),
      };
      renderFrame(0, false, showSafeZone);
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
    renderFrame,
    showSafeZone,
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
        maxFallbackSeconds: 20,
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
        v.currentTime = videoClip.trimStart;
        return;
      }

      if (elapsedSec < 7.48) {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - videoClip.trimStart) > 0.15) {
          v.currentTime = videoClip.trimStart;
        }
        return;
      }

      if (elapsedSec >= timeline.outroWipeEndSec) {
        if (!v.paused) v.pause();
        return;
      }

      const relSec = Math.max(0, elapsedSec - 7.6);
      const targetSec = Math.min(videoClip.trimEnd, videoClip.trimStart + relSec);
      if (v.paused && targetSec < videoClip.trimEnd - 0.05) {
        v.play().catch(() => {});
      }
      if (Math.abs(v.currentTime - targetSec) > 0.32) {
        v.currentTime = targetSec;
      }
    },
    [mediaMode, videoClip, timeline.outroWipeEndSec]
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
    const next = pickSmartRandomTrack(template, { excludeId: selectedTrackId });
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
          const clipStartCtx = startAt + 7.6;
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
    setPreviewPlaying(true);
    await unlockHiddenVideoGesture();
    syncHiddenVideoAt(0, false);
    warmUpGpuTextures();
    renderFrame(0, true, showSafeZone);
    const totalDur = timeline.totalDurationSec;
    const session = await startBroadcastAudioSession('preview');
    const start = performance.now();
    const tick = (now: number) => {
      const elapsedSec = (now - start) / 1000;
      if (elapsedSec <= totalDur) {
        syncHiddenVideoAt(elapsedSec, true);
        renderFrame(elapsedSec, true, showSafeZone);
        previewRafRef.current = requestAnimationFrame(tick);
      } else {
        syncHiddenVideoAt(0, false);
        session.stop();
        setPreviewPlaying(false);
        renderFrame(0, false, showSafeZone);
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

  const handleExportVideo = async () => {
    const canvas = canvasRef.current;
    if (!canvas || exportingVideo) return;
    setExportingVideo(true);
    setPreviewPlaying(false);
    cancelAnimationFrame(previewRafRef.current);
    setVideoProgress(0);
    await unlockHiddenVideoGesture();
    syncHiddenVideoAt(0, false);
    warmUpGpuTextures();
    renderFrame(0, true, false);

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

      recorder.onstop = () => {
        syncHiddenVideoAt(0, false);
        audioSession.stop();
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setExportedVideoBlob(blob);
        setExportedVideoUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setExportedVideoExt(ext);
        setExportingVideo(false);
        setVideoProgress(0);
        setStatusMsg(`Video broadcast ${totalDur} detik (.${ext}) siap diputar!`);
        setTimeout(() => setStatusMsg(null), 4000);
      };

      recorder.start();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const curSec = progress * totalDur;
        syncHiddenVideoAt(curSec, true);
        renderFrame(curSec, true, false);
        setVideoProgress(Math.round(progress * 100));
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          recorder.stop();
          renderFrame(0, false, showSafeZone);
        }
      };

      requestAnimationFrame(animate);
    } catch (err) {
      syncHiddenVideoAt(0, false);
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
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                  Langkah 1: Pilih Match &amp; Sumber Media
                </h2>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Pertandingan
                </label>
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

              {/* Media Source Mode Selector: Multi-Photo (1-3) vs Single Video + Cut */}
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Jenis Dokumentasi Momen
                </label>
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
                    Foto Momen (1 - {MAX_STUDIO_PHOTOS})
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
                    Klip Video (Maks 1 + Cut)
                  </button>
                </div>
              </div>

              {mediaMode === 'photo' ? (
                <div className="space-y-3">
                  {photoItems.length < MAX_STUDIO_PHOTOS && (
                    <label
                      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-700 transition hover:border-amber-600 hover:text-amber-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-amber-400 dark:hover:text-amber-300 ${
                        convertingMedia ? 'pointer-events-none opacity-60' : ''
                      }`}
                    >
                      <ImagePlus className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                      <span>
                        {convertingMedia
                          ? 'Mengonversi & mengoptimalkan foto di browser...'
                          : photoItems.length === 0
                            ? `Pilih 1 s.d. ${MAX_STUDIO_PHOTOS} Foto (JPG / PNG / WebP / HEIC iPhone)`
                            : `Tambah Foto Lagi (${photoItems.length}/${MAX_STUDIO_PHOTOS} terpilih)`}
                      </span>
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                        Mendukung HEIC iPhone otomatis (engine browser) • Kolase &amp; slideshow siap pakai
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
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          Urutan Foto Terpilih ({photoItems.length}/{MAX_STUDIO_PHOTOS})
                        </span>
                        <span className="text-[11px] text-amber-800 dark:text-amber-400">
                          #1 jadi Foto Utama • Durasi Video: {timeline.totalDurationSec}s
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2.5">
                        {photoItems.map((item, idx) => (
                          <div
                            key={item.id}
                            className={`overflow-hidden rounded-xl border bg-slate-950 ${
                              idx === 0
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
                                {idx === 0 ? '#1 UTAMA' : `#${idx + 1}`}
                              </span>
                            </div>
                            <div className="flex items-center justify-between bg-white px-1 py-1 dark:bg-slate-900">
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => handleMovePhoto(idx, -1)}
                                  aria-label="Geser foto ke kiri"
                                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <ArrowLeft className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === photoItems.length - 1}
                                  onClick={() => handleMovePhoto(idx, 1)}
                                  aria-label="Geser foto ke kanan"
                                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemovePhoto(item.id)}
                                aria-label="Hapus foto"
                                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded text-red-600 hover:bg-red-500/10 dark:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {!videoClip ? (
                    <label
                      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-700 transition hover:border-amber-600 hover:text-amber-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-amber-400 dark:hover:text-amber-300 ${
                        convertingMedia ? 'pointer-events-none opacity-60' : ''
                      }`}
                    >
                      <Video className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                      <span>
                        {convertingMedia
                          ? 'Menyiapkan / mengonversi video .MOV di browser...'
                          : 'Pilih 1 Klip Video (.MOV iPhone / .MP4) dari HP atau Laptop'}
                      </span>
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                        Support .MOV iPhone &amp; .MP4 (engine browser + cut maks {MAX_VIDEO_CLIP_SEC}s tanpa beban server)
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
                    <VideoTrimmerControl
                      clip={videoClip}
                      onChange={setVideoClip}
                      onCaptureCover={(img) => setVideoCoverImg(img)}
                      onRemove={handleRemoveVideoClip}
                    />
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
              <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                Langkah 2: Format, Gaya &amp; Caption
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Broadcast Template
                  </label>
                  <div className="grid gap-1.5">
                    {(
                      [
                        ['live', 'LIVE MATCH (Active Set Score)'],
                        ['final', 'FINAL SCORE (Full-Time Result)'],
                        ['upcoming', 'UPCOMING MATCH (Fixture)'],
                        ['highlight', 'MATCH HIGHLIGHT (Action)'],
                        ['champion', 'CHAMPIONS & PODIUM (Winners)'],
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
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Aspect Ratio
                  </label>
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

              {/* Stage Theme Selector (Quarter-Final, Semi-Final, 3rd Place, Grand Final) OR Champion/Podium Selector */}
              {template === 'champion' ? (
                <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      <Trophy className="h-4 w-4" />
                      Championship &amp; Podium Variant
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
                        Spotlight Team (Auto from Bracket / Manual Override)
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
              ) : (
                <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <label className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                      Match Stage Badge &amp; Visual Theme
                    </label>
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-800 dark:text-amber-300">
                      Active: {stageDisplayBadge}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['auto', 'Auto (From Match)'],
                        ['pool', 'Pool Stage'],
                        ['r16', 'Round of 16'],
                        ['qf', 'Quarter-Final'],
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

              {mediaMode === 'photo' && photoItems.length >= 2 && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/8 p-3.5">
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Tampilan Poster PNG &amp; Live Report ({photoItems.length} Foto)
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
                      Jadwal Tanding (Otomatis dari Bagan)
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
                      Lapangan (Otomatis dari Bagan)
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

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Caption / Keterangan Singkat
                </label>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Contoh: Spike keras penentu kemenangan di Set 2!"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              {/* Smart Auto-First BGM & ReactBits SFX Controls */}
              <div className="space-y-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Music className="h-4 w-4 text-amber-500" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                      Musik Video &amp; SFX Transisi
                    </span>
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-600 dark:text-amber-400">
                      {audioMode === 'auto'
                        ? 'Auto-Pick'
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
                      title="Acak lagu lain yang cocok dengan template ini"
                    >
                      <Shuffle className="h-3 w-3" />
                      Acak Ulang
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        stopMiniAudio();
                        setAudioMode((m) => (m === 'manual' ? 'auto' : 'manual'));
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      {audioMode === 'manual' ? 'Kembali Otomatis' : 'Pilih Manual'}
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
                      <optgroup label="Rekomendasi Sesuai Template Ini">
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
                      <option value="__none__">Tanpa Musik Latar (Hanya SFX / Bisu)</option>
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
                    <span>SFX Transisi (Whoosh &amp; Impact)</span>
                  </label>
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold dark:border-slate-800 dark:bg-slate-950">
                <input
                  type="checkbox"
                  checked={includeOutro}
                  onChange={(e) => setIncludeOutro(e.target.checked)}
                />
                Sertakan Penutup Logo Penyelenggara (SMANSAGE/AVERSA) &amp; Sponsor (
                {sponsorList.length} logo)
              </label>

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
              <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                Langkah 3: Preview, Export &amp; Publish
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                <ShinyText className="font-bold">
                  Engine 3D Three.js + ReactBits Motion ({timeline.totalDurationSec}s Adaptif Tanpa Cut Kasar):
                </ShinyText>{' '}
                <strong>Intro SVC 3D</strong> → <strong>Ribbon Stinger</strong> →{' '}
                <strong>{teamA?.shortCode || 'TIM A'} vs {teamB?.shortCode || 'TIM B'}</strong> →{' '}
                <strong>
                  {mediaMode === 'video'
                    ? 'Shutter Split ke Klip Video + Skor'
                    : photoItems.length >= 2
                      ? `Shutter Split ke ${photoItems.length} Foto Momen + Skor`
                      : 'Shutter Split ke Foto + Skor'}
                </strong>{' '}
                {includeOutro && (
                  <>
                    → <strong>Penyelenggara &amp; Sponsor</strong>
                  </>
                )}
                .
              </p>

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
                    : `Putar Preview Animasi (${timeline.totalDurationSec}s)`}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPng}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-xs font-bold text-slate-900 transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <Download className="h-4 w-4" />
                  {mediaMode === 'video'
                    ? 'Export Cover Poster (PNG)'
                    : photoItems.length >= 2 && posterLayout === 'collage'
                      ? `Export Kolase ${photoItems.length} Foto (PNG)`
                      : 'Export Foto (PNG)'}
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
                    : `Export Video Broadcast (${timeline.totalDurationSec}s)`}
                </button>

                <button
                  type="button"
                  disabled={publishing || !activeMatch}
                  onClick={handlePublish}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {publishing
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
          <div className="flex items-center gap-2.5">
            {ratio === '9:16' && (
              <button
                type="button"
                onClick={() => setShowSafeZone((v) => !v)}
                className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition ${
                  showSafeZone
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-500'
                    : 'border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400'
                }`}
                title="Garis bantu area aman Instagram Story (hanya tampil di pratinjau, tidak ikut ter-export)"
              >
                {showSafeZone ? 'Safe Zone IG: ON' : 'Safe Zone IG: OFF'}
              </button>
            )}
            <span>
              {DIMENSIONS[ratio].w}×{DIMENSIONS[ratio].h}
            </span>
          </div>
        </div>

        <div className="flex w-full items-center justify-center overflow-hidden rounded-xl bg-slate-950 p-2">
          <canvas
            ref={canvasRef}
            className="max-h-[520px] max-w-full rounded-lg object-contain shadow-xl"
          />
        </div>

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
            <div>
              <h3 className="flex items-center gap-2 font-display text-base font-extrabold uppercase tracking-wider">
                <LayoutGrid className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                Galeri Momen Terpublikasi ({data.reports.length})
              </h3>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Mendukung geser multi-slide foto dan pemutar video langsung di Portal Publik maupun Rincian Pertandingan.
              </p>
            </div>
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

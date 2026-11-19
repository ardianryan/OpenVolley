export type StudioMediaMode = 'photo' | 'video';

export const MAX_STUDIO_PHOTOS = 3;
export const MIN_VIDEO_CLIP_SEC = 2.0;
export const MAX_VIDEO_CLIP_SEC = 15.0;
export const DEFAULT_VIDEO_CLIP_SEC = 10.0;
export const SCENE4_START_SEC = 7.65;
export const OUTRO_DURATION_SEC = 4.55;
export const OUTRO_WIPE_SPAN_SEC = 1.1;

export interface MediaTimelinePlan {
  scene4StartSec: number;
  scene4HoldSec: number;
  outroStartSec: number;
  outroWipeEndSec: number;
  totalDurationSec: number;
  slideTriggerSecs: number[];
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Computes adaptive broadcast video timeline timestamps for 1-3 photos or a trimmed video clip.
 */
export function computeMediaTimeline(params: {
  mediaMode: StudioMediaMode;
  photoCount: number;
  clipDurationSec: number;
  includeOutro: boolean;
}): MediaTimelinePlan {
  const { mediaMode, photoCount, clipDurationSec, includeOutro } = params;

  let scene4HoldSec = 5.8;
  const slideTriggerSecs: number[] = [];

  if (mediaMode === 'video') {
    const validClip = Number.isFinite(clipDurationSec) && clipDurationSec > 0
      ? clamp(clipDurationSec, 1.0, MAX_VIDEO_CLIP_SEC)
      : 6.0;
    scene4HoldSec = Number(validClip.toFixed(2));
  } else {
    const count = clamp(Math.floor(photoCount) || 1, 1, MAX_STUDIO_PHOTOS);
    if (count === 1) {
      scene4HoldSec = 5.8;
    } else if (count === 2) {
      const perSlide = 3.4;
      scene4HoldSec = perSlide * 2; // 6.8s
      slideTriggerSecs.push(Number((SCENE4_START_SEC + perSlide - 0.25).toFixed(2)));
    } else {
      const perSlide = 3.2;
      scene4HoldSec = Number((perSlide * 3).toFixed(2)); // 9.6s
      slideTriggerSecs.push(
        Number((SCENE4_START_SEC + perSlide - 0.25).toFixed(2)),
        Number((SCENE4_START_SEC + perSlide * 2 - 0.25).toFixed(2))
      );
    }
  }

  const outroStartSec = Number((SCENE4_START_SEC + scene4HoldSec).toFixed(2));
  const outroWipeEndSec = Number((outroStartSec + OUTRO_WIPE_SPAN_SEC).toFixed(2));
  const totalDurationSec = includeOutro
    ? Number((outroStartSec + OUTRO_DURATION_SEC).toFixed(1))
    : Number((outroStartSec + 0.85).toFixed(1));

  return {
    scene4StartSec: SCENE4_START_SEC,
    scene4HoldSec,
    outroStartSec,
    outroWipeEndSec,
    totalDurationSec,
    slideTriggerSecs,
  };
}

/**
 * Enforces valid [trimStart, trimEnd] bounds within [0, durationSec] and [MIN_VIDEO_CLIP_SEC, MAX_VIDEO_CLIP_SEC].
 */
export function clampTrimWindow(
  durationSec: number,
  rawStart: number,
  rawEnd: number,
  editedSide: 'start' | 'end'
): { trimStart: number; trimEnd: number } {
  const safeDur = Math.max(0.5, Number.isFinite(durationSec) ? durationSec : 10);
  const minSpan = Math.min(MIN_VIDEO_CLIP_SEC, safeDur);
  const maxSpan = Math.min(MAX_VIDEO_CLIP_SEC, safeDur);

  let start = clamp(rawStart, 0, safeDur);
  let end = clamp(rawEnd, 0, safeDur);

  if (editedSide === 'start') {
    start = clamp(start, 0, Math.max(0, safeDur - minSpan));
    if (end - start < minSpan) {
      end = Math.min(safeDur, start + minSpan);
    } else if (end - start > maxSpan) {
      end = Math.min(safeDur, start + maxSpan);
    }
  } else {
    end = clamp(end, minSpan, safeDur);
    if (end - start < minSpan) {
      start = Math.max(0, end - minSpan);
    } else if (end - start > maxSpan) {
      start = Math.max(0, end - maxSpan);
    }
  }

  return {
    trimStart: Number(start.toFixed(1)),
    trimEnd: Number(end.toFixed(1)),
  };
}

/**
 * Shifts the active trim window [trimStart, trimEnd] together by deltaSec while preserving span and clamping to [0, durationSec].
 */
export function shiftTrimWindow(
  durationSec: number,
  currentStart: number,
  currentEnd: number,
  deltaSec: number
): { trimStart: number; trimEnd: number } {
  const safeDur = Math.max(0.5, Number.isFinite(durationSec) ? durationSec : 10);
  const minSpan = Math.min(MIN_VIDEO_CLIP_SEC, safeDur);
  const maxSpan = Math.min(MAX_VIDEO_CLIP_SEC, safeDur);
  const span = clamp(currentEnd - currentStart, minSpan, maxSpan);
  const nextStart = clamp(currentStart + deltaSec, 0, Math.max(0, safeDur - span));

  return {
    trimStart: Number(nextStart.toFixed(1)),
    trimEnd: Number((nextStart + span).toFixed(1)),
  };
}

export interface PhotoSlideState {
  primaryIdx: number;
  nextIdx: number | null;
  wipeProgress: number;
  localProgressPrimary: number;
  localProgressNext: number;
}

/**
 * Computes active photo index, optional diagonal transition wipe progress, and per-slide Ken Burns progress.
 */
export function computePhotoSlideState(
  photoCount: number,
  elapsedInScene4: number,
  scene4HoldSec: number
): PhotoSlideState {
  const count = clamp(Math.floor(photoCount) || 1, 1, MAX_STUDIO_PHOTOS);
  const safeHold = Math.max(1, scene4HoldSec);
  const t = clamp(elapsedInScene4, 0, safeHold);

  if (count === 1) {
    return {
      primaryIdx: 0,
      nextIdx: null,
      wipeProgress: 0,
      localProgressPrimary: clamp(t / safeHold, 0, 1),
      localProgressNext: 0,
    };
  }

  const segLen = safeHold / count;
  const wipeDur = Math.min(0.55, segLen * 0.28);
  const rawIdx = Math.min(count - 1, Math.floor(t / segLen));
  const segStart = rawIdx * segLen;
  const segElapsed = t - segStart;

  const isTransitioningOut = rawIdx < count - 1 && segElapsed >= segLen - wipeDur;
  if (isTransitioningOut) {
    const wipeP = clamp((segElapsed - (segLen - wipeDur)) / wipeDur, 0, 1);
    return {
      primaryIdx: rawIdx,
      nextIdx: rawIdx + 1,
      wipeProgress: wipeP,
      localProgressPrimary: clamp(segElapsed / segLen, 0, 1),
      localProgressNext: clamp((wipeP * wipeDur) / segLen, 0, 1),
    };
  }

  return {
    primaryIdx: rawIdx,
    nextIdx: null,
    wipeProgress: 0,
    localProgressPrimary: clamp(segElapsed / segLen, 0, 1),
    localProgressNext: 0,
  };
}

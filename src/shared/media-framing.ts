export const MIN_MEDIA_ZOOM = 1;
export const MAX_MEDIA_ZOOM = 3;

export interface MediaFraming {
  zoom: number;
  panX: number;
  panY: number;
}

export interface SlotRect {
  rx: number;
  ry: number;
  rw: number;
  rh: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function floor4(n: number): number {
  return Math.floor(Math.max(0, n) * 10000) / 10000;
}

/**
 * Computes maximum horizontal & vertical pan fractions (relative to slot rect width/height)
 * so cover-cropped media never pulls away from any edge to expose black bars.
 */
export function computeMaxPanFractions(
  srcW: number,
  srcH: number,
  rectW: number,
  rectH: number,
  zoom: number
): { maxPanX: number; maxPanY: number } {
  const safeZoom = clamp(Number.isFinite(zoom) ? zoom : MIN_MEDIA_ZOOM, MIN_MEDIA_ZOOM, MAX_MEDIA_ZOOM);
  if (srcW > 0 && srcH > 0 && rectW > 0 && rectH > 0) {
    const srcAspect = srcW / srcH;
    const rectAspect = rectW / rectH;
    let dw = rectW;
    let dh = rectH;
    if (srcAspect > rectAspect) {
      dh = rectH * safeZoom;
      dw = dh * srcAspect;
    } else {
      dw = rectW * safeZoom;
      dh = dw / srcAspect;
    }
    return {
      maxPanX: floor4((dw - rectW) / (2 * rectW)),
      maxPanY: floor4((dh - rectH) / (2 * rectH)),
    };
  }
  const fallback = floor4(Math.max(0.5, (safeZoom - 1) / 2));
  return { maxPanX: fallback, maxPanY: fallback };
}

/**
 * Clamps zoom to [MIN_MEDIA_ZOOM, MAX_MEDIA_ZOOM] and panX/panY within cover bounds.
 */
export function clampMediaFraming(
  framing: MediaFraming,
  srcW = 0,
  srcH = 0,
  rectW = 0,
  rectH = 0
): MediaFraming {
  const zoom = round4(
    clamp(
      Number.isFinite(framing.zoom) ? framing.zoom : MIN_MEDIA_ZOOM,
      MIN_MEDIA_ZOOM,
      MAX_MEDIA_ZOOM
    )
  );
  const { maxPanX, maxPanY } = computeMaxPanFractions(srcW, srcH, rectW, rectH, zoom);
  const panX = round4(clamp(Number.isFinite(framing.panX) ? framing.panX : 0, -maxPanX, maxPanX));
  const panY = round4(clamp(Number.isFinite(framing.panY) ? framing.panY : 0, -maxPanY, maxPanY));
  return { zoom, panX, panY };
}

/**
 * Applies pixel pointer drag delta 1:1 onto normalized framing fractions and clamps to cover bounds.
 */
export function applyPanDelta(
  current: MediaFraming,
  deltaPxX: number,
  deltaPxY: number,
  framePxW: number,
  framePxH: number,
  srcW = 0,
  srcH = 0,
  rectW = 0,
  rectH = 0
): MediaFraming {
  const nextPanX = (Number.isFinite(current.panX) ? current.panX : 0) + deltaPxX / Math.max(1, framePxW);
  const nextPanY = (Number.isFinite(current.panY) ? current.panY : 0) + deltaPxY / Math.max(1, framePxH);
  return clampMediaFraming(
    { zoom: current.zoom, panX: nextPanX, panY: nextPanY },
    srcW,
    srcH,
    rectW,
    rectH
  );
}

/**
 * Updates zoom level and re-clamps panX/panY so zooming out never exposes empty borders.
 */
export function applyZoomLevel(
  current: MediaFraming,
  nextZoom: number,
  srcW = 0,
  srcH = 0,
  rectW = 0,
  rectH = 0
): MediaFraming {
  return clampMediaFraming(
    { zoom: nextZoom, panX: current.panX, panY: current.panY },
    srcW,
    srcH,
    rectW,
    rectH
  );
}

/**
 * Computes exact slot rectangles for 1-, 2-, or 3-photo poster/collage layouts
 * matching the canvas renderer so pointer hit-testing and drawing share one source of truth.
 */
export function getCollageSlotRects(
  photoCount: number,
  posterLayout: 'collage' | 'single',
  w: number,
  h: number,
  safeTop: number,
  safeBottom: number,
  u: number,
  isLandscape: boolean
): SlotRect[] {
  if (photoCount <= 1 || posterLayout === 'single') {
    return [{ rx: 0, ry: 0, rw: w, rh: h }];
  }

  const visTop = safeTop + Math.round(u * 0.105);
  const visBot = h - safeBottom - Math.round(u * 0.27);

  if (photoCount === 2) {
    if (isLandscape) {
      const splitX = Math.round(w * 0.5);
      return [
        { rx: 0, ry: 0, rw: splitX, rh: h },
        { rx: splitX, ry: 0, rw: w - splitX, rh: h },
      ];
    }
    const splitY = Math.round((visTop + visBot) / 2);
    return [
      { rx: 0, ry: 0, rw: w, rh: splitY },
      { rx: 0, ry: splitY, rw: w, rh: h - splitY },
    ];
  }

  if (isLandscape) {
    const splitX = Math.round(w * 0.56);
    const splitY = Math.round(h * 0.5);
    return [
      { rx: 0, ry: 0, rw: splitX, rh: h },
      { rx: splitX, ry: 0, rw: w - splitX, rh: splitY },
      { rx: splitX, ry: splitY, rw: w - splitX, rh: h - splitY },
    ];
  }

  const splitY = Math.round(visTop + (visBot - visTop) * 0.54);
  const splitX = Math.round(w * 0.5);
  return [
    { rx: 0, ry: 0, rw: w, rh: splitY },
    { rx: 0, ry: splitY, rw: splitX, rh: h - splitY },
    { rx: splitX, ry: splitY, rw: w - splitX, rh: h - splitY },
  ];
}

/**
 * Returns the slot index under canvas point (x, y), defaulting to 0.
 */
export function hitTestCollageSlot(rects: SlotRect[], x: number, y: number): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (x >= r.rx && x <= r.rx + r.rw && y >= r.ry && y <= r.ry + r.rh) {
      return i;
    }
  }
  return 0;
}

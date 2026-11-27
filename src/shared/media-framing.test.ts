import { describe, expect, it } from 'bun:test';
import {
  applyPanDelta,
  applyZoomLevel,
  clampMediaFraming,
  computeMaxPanFractions,
  getCollageSlotRects,
  hitTestCollageSlot,
} from './media-framing';

describe('Media Direct Crop & Cover-Bounded Framing Math', () => {
  it('allows horizontal pan at zoom=1 for landscape photo in 9:16 portrait while locking vertical pan', () => {
    const { maxPanX, maxPanY } = computeMaxPanFractions(1600, 900, 1080, 1920, 1);
    expect(maxPanX).toBeGreaterThan(1.0);
    expect(maxPanY).toBe(0);

    const panned = applyPanDelta({ zoom: 1, panX: 0, panY: 0 }, -150, 200, 300, 533, 1600, 900, 1080, 1920);
    expect(panned.panX).toBeCloseTo(-0.5, 3);
    expect(panned.panY).toBe(0);
  });

  it('expands pan bounds at 2.0x zoom and cleanly re-clamps when zooming back out to 1.0x', () => {
    const bounds2x = computeMaxPanFractions(1200, 900, 1080, 1920, 2);
    expect(bounds2x.maxPanX).toBeGreaterThan(0.5);
    expect(bounds2x.maxPanY).toBeCloseTo(0.5, 4);

    const zoomedIn = clampMediaFraming({ zoom: 2, panX: 0.9, panY: 0.48 }, 1200, 900, 1080, 1920);
    expect(zoomedIn.panY).toBeCloseTo(0.48, 3);

    const zoomedOut = applyZoomLevel(zoomedIn, 1.0, 1200, 900, 1080, 1920);
    expect(zoomedOut.zoom).toBe(1);
    expect(zoomedOut.panY).toBe(0);
    expect(zoomedOut.panX).toBeLessThanOrEqual(computeMaxPanFractions(1200, 900, 1080, 1920, 1).maxPanX);
  });

  it('keeps pan delta 1:1 with pointer drag pixels and clamps extreme drags to cover bounds', () => {
    const dragged = applyPanDelta({ zoom: 1.5, panX: 0, panY: 0 }, 40, -25, 200, 200, 1080, 1080, 1080, 1080);
    expect(dragged.panX).toBeCloseTo(0.2, 3);
    expect(dragged.panY).toBeCloseTo(-0.125, 3);

    const overDragged = applyPanDelta({ zoom: 1.5, panX: 0, panY: 0 }, 5000, -5000, 200, 200, 1080, 1080, 1080, 1080);
    expect(overDragged.panX).toBeCloseTo(0.25, 3);
    expect(overDragged.panY).toBeCloseTo(-0.25, 3);
  });

  it('computes symmetric collage slot rects and hit-tests pointer positions accurately', () => {
    const rects2Portrait = getCollageSlotRects(2, 'collage', 1080, 1920, 140, 180, 1080, false);
    expect(rects2Portrait).toHaveLength(2);
    expect(hitTestCollageSlot(rects2Portrait, 540, 200)).toBe(0);
    expect(hitTestCollageSlot(rects2Portrait, 540, 1400)).toBe(1);

    const rects3Landscape = getCollageSlotRects(3, 'collage', 1920, 1080, 50, 50, 1080, true);
    expect(rects3Landscape).toHaveLength(3);
    expect(hitTestCollageSlot(rects3Landscape, 400, 540)).toBe(0);
    expect(hitTestCollageSlot(rects3Landscape, 1400, 200)).toBe(1);
    expect(hitTestCollageSlot(rects3Landscape, 1400, 800)).toBe(2);

    const singleRect = getCollageSlotRects(3, 'single', 1080, 1920, 140, 180, 1080, false);
    expect(singleRect).toEqual([{ rx: 0, ry: 0, rw: 1080, rh: 1920 }]);

    const rects4 = getCollageSlotRects(4, 'collage', 1080, 1920, 140, 180, 1080, false);
    expect(rects4).toHaveLength(4);

    const rects5 = getCollageSlotRects(5, 'collage', 1920, 1080, 50, 50, 1080, true);
    expect(rects5).toHaveLength(5);

    const rects6 = getCollageSlotRects(6, 'collage', 1080, 1920, 140, 180, 1080, false);
    expect(rects6).toHaveLength(6);
    expect(hitTestCollageSlot(rects6, 900, 1800)).toBe(5);
  });
});

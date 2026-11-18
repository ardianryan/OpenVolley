import { describe, expect, test } from 'bun:test';
import {
  MAX_VIDEO_CLIP_SEC,
  clampTrimWindow,
  computeMediaTimeline,
  computePhotoSlideState,
} from './media-timeline';

describe('Media Studio Adaptive Timeline & Video Trimmer Math', () => {
  test('1 photo with outro keeps standard 18.0s timeline', () => {
    const plan = computeMediaTimeline({
      mediaMode: 'photo',
      photoCount: 1,
      clipDurationSec: 0,
      includeOutro: true,
    });
    expect(plan.totalDurationSec).toBe(18);
    expect(plan.outroStartSec).toBe(13.45);
    expect(plan.slideTriggerSecs).toEqual([]);
  });

  test('3 photos expand Scene 4 smoothly (~21.8s) and emit 2 slide transition triggers', () => {
    const plan = computeMediaTimeline({
      mediaMode: 'photo',
      photoCount: 3,
      clipDurationSec: 0,
      includeOutro: true,
    });
    expect(plan.scene4HoldSec).toBe(9.6);
    expect(plan.totalDurationSec).toBe(21.8);
    expect(plan.slideTriggerSecs.length).toBe(2);
  });

  test('video clip mode adapts total duration to trimmed clip length (clamped <= 15s)', () => {
    const plan10 = computeMediaTimeline({
      mediaMode: 'video',
      photoCount: 0,
      clipDurationSec: 10,
      includeOutro: true,
    });
    expect(plan10.scene4HoldSec).toBe(10);
    expect(plan10.outroStartSec).toBe(17.65);
    expect(plan10.totalDurationSec).toBe(22.2);

    const planCapped = computeMediaTimeline({
      mediaMode: 'video',
      photoCount: 0,
      clipDurationSec: 42,
      includeOutro: true,
    });
    expect(planCapped.scene4HoldSec).toBe(MAX_VIDEO_CLIP_SEC);
  });

  test('clampTrimWindow enforces 2s minimum and 15s maximum span cleanly', () => {
    const tooLong = clampTrimWindow(45, 2, 30, 'end');
    expect(tooLong.trimEnd).toBe(30);
    expect(tooLong.trimEnd - tooLong.trimStart).toBe(15);

    const tooShort = clampTrimWindow(20, 8, 8.4, 'start');
    expect(tooShort.trimEnd - tooShort.trimStart).toBe(2);
  });

  test('computePhotoSlideState transitions smoothly across 3 photos', () => {
    const start = computePhotoSlideState(3, 0.5, 9.6);
    expect(start.primaryIdx).toBe(0);
    expect(start.nextIdx).toBeNull();

    const wiping = computePhotoSlideState(3, 3.0, 9.6);
    expect(wiping.primaryIdx).toBe(0);
    expect(wiping.nextIdx).toBe(1);
    expect(wiping.wipeProgress).toBeGreaterThan(0);

    const last = computePhotoSlideState(3, 8.5, 9.6);
    expect(last.primaryIdx).toBe(2);
    expect(last.nextIdx).toBeNull();
  });
});

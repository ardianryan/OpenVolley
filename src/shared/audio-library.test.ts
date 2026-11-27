import { describe, expect, it } from 'bun:test';
import {
  AUDIO_TRACKS,
  getTracksForTemplate,
  pickSmartRandomTrack,
} from './audio-library';

describe('Audio Library & Smart Auto-Pick', () => {
  it('contains all 48 S3-hosted tracks with valid https URLs', () => {
    expect(AUDIO_TRACKS.length).toBe(48);
    for (const track of AUDIO_TRACKS) {
      expect(track.url).toStartWith('https://is3-storage.smage.my.id/svc-media/audio/');
      expect(track.url).toEndWith('.mp3');
    }
  });

  it('provides a rich pool of upcoming pre-match tracks', () => {
    const upcomingPool = getTracksForTemplate('upcoming');
    expect(upcomingPool.length).toBeGreaterThanOrEqual(8);
  });

  it('picks tracks within the requested template pool and avoids repeating excludeId', () => {
    const livePool = getTracksForTemplate('live');
    expect(livePool.length).toBeGreaterThanOrEqual(4);

    const first = livePool[0];
    for (let i = 0; i < 15; i++) {
      const picked = pickSmartRandomTrack('live', { excludeId: first.id });
      expect(picked.categories).toContain('live');
      expect(picked.id).not.toBe(first.id);
    }
  });

  it('prioritizes high-stakes tracks when isHighStakes is true', () => {
    const picked = pickSmartRandomTrack('live', {
      isHighStakes: true,
      rng: () => 0.1,
    });
    expect(picked.highStakes).toBe(true);
  });
});

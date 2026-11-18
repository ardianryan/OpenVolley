import { describe, expect, test } from 'bun:test';
import { getTracksForTemplate, pickSmartRandomTrack } from './audio-library';
import {
  detectMatchStageKey,
  formatInternationalStageLabel,
  formatRoundColumnLabel,
} from './stages';

describe('International Volleyball Stage & Ceremony Helpers', () => {
  test('maps 16-team knockout rounds (totalRounds = 4) to international FIVB stage labels', () => {
    expect(
      formatInternationalStageLabel({ round: 1, bracketType: 'main' }, 4)
    ).toBe('Round of 16');
    expect(
      formatInternationalStageLabel({ round: 2, bracketType: 'main' }, 4)
    ).toBe('Quarter-Final');
    expect(
      formatInternationalStageLabel({ round: 3, bracketType: 'main' }, 4)
    ).toBe('Semi-Final');
    expect(
      formatInternationalStageLabel({ round: 4, bracketType: 'main' }, 4)
    ).toBe('Grand Final');
    expect(
      formatInternationalStageLabel({ round: 4, bracketType: 'third_place' }, 4)
    ).toBe('3rd Place Match');
  });

  test('maps pool matches and split bracket wing headers cleanly', () => {
    expect(
      formatInternationalStageLabel(
        { round: 1, bracketType: 'pool', poolName: 'b' },
        3
      )
    ).toBe('Pool B');
    expect(formatRoundColumnLabel(3, 4, 'L')).toBe('Semi-Final (L)');
    expect(formatRoundColumnLabel(3, 4, 'R')).toBe('Semi-Final (R)');
    expect(detectMatchStageKey({ round: 2, bracketType: 'main' }, 4)).toBe('qf');
    expect(detectMatchStageKey({ round: 4, bracketType: 'third_place' }, 4)).toBe(
      'third'
    );
  });

  test('champion template selects ceremony / trophy tracks cleanly', () => {
    const champTracks = getTracksForTemplate('champion');
    expect(champTracks.length).toBeGreaterThanOrEqual(2);
    expect(champTracks.some((t) => t.categories.includes('ceremony'))).toBe(true);

    const picked = pickSmartRandomTrack('champion', { rng: () => 0.1 });
    expect(Boolean(picked.url)).toBe(true);
  });
});

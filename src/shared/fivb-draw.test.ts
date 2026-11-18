import { describe, expect, test } from 'bun:test';
import {
  buildFivbSeedOrder,
  computeFivbKnockoutSeedAssignment,
  computeFivbPoolSnakeAssignment,
  inferTeamLevelFromName,
  isPlaceholderDrawSlotName,
} from './fivb-draw';

function makeDeterministicRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('FIVB Smart Seeding, Region Separation & Master Level Helpers', () => {
  test('infers school/contingent level and detects draw slot placeholders accurately', () => {
    expect(inferTeamLevelFromName('SMPN 1 Gedeg', 'Kab. Mojokerto')).toBe('smp');
    expect(inferTeamLevelFromName('MTS Nurul Huda', 'Mojokerto')).toBe('smp');
    expect(inferTeamLevelFromName('SMAN 1 Gedeg', 'Kab. Mojokerto')).toBe('sma');
    expect(inferTeamLevelFromName('Kab. Mojokerto', 'Jawa Timur')).toBe('kab_kota');
    expect(inferTeamLevelFromName('Petrokimia Volley Club', 'Gresik')).toBe('umum');

    expect(isPlaceholderDrawSlotName('[ Undian 01 ]')).toBe(true);
    expect(isPlaceholderDrawSlotName('[ Slot 16 ]')).toBe(true);
    expect(isPlaceholderDrawSlotName('SMPN 2 Kota Mojokerto')).toBe(false);
  });

  test('places top 2 seeded teams on opposite wings and separates same-region teams in Round 1', () => {
    const teams = [
      { id: 1, school: 'Kota Mojokerto', isSeeded: true, seed: 1 },
      { id: 2, school: 'Sidoarjo', isSeeded: true, seed: 2 },
      { id: 3, school: 'Kota Mojokerto', isSeeded: false },
      { id: 4, school: 'Sidoarjo', isSeeded: false },
      { id: 5, school: 'Gresik', isSeeded: false },
      { id: 6, school: 'Gresik', isSeeded: false },
      { id: 7, school: 'Jombang', isSeeded: false },
      { id: 8, school: 'Lamongan', isSeeded: false },
    ];

    const assigned = computeFivbKnockoutSeedAssignment(teams, {
      separateSameRegion: true,
      randomFn: makeDeterministicRng(101),
    });

    const bySeed = new Map(assigned.map((a) => [a.assignedSeed, a.entry]));
    // Seed 1 and Seed 2 locked at #1 and #2
    expect(bySeed.get(1)!.id).toBe(1);
    expect(bySeed.get(2)!.id).toBe(2);

    // Check Round-1 pairings: [1v8, 4v5, 2v7, 3v6] -> zero same-region clashes!
    const order = buildFivbSeedOrder(8);
    for (let m = 0; m < 4; m++) {
      const tA = bySeed.get(order[m * 2]!)!;
      const tB = bySeed.get(order[m * 2 + 1]!)!;
      expect(tA.school).not.toBe(tB.school);
    }
  });

  test('distributes teams via FIVB Serpentine Snake Seeding across pools without clustering regions', () => {
    const entries = [
      { id: 1, school: 'Mojokerto', isSeeded: true, seed: 1 },
      { id: 2, school: 'Sidoarjo', isSeeded: true, seed: 2 },
      { id: 3, school: 'Gresik', isSeeded: true, seed: 3 },
      { id: 4, school: 'Surabaya', isSeeded: true, seed: 4 },
      { id: 5, school: 'Mojokerto' },
      { id: 6, school: 'Mojokerto' },
      { id: 7, school: 'Sidoarjo' },
      { id: 8, school: 'Gresik' },
    ];

    const res = computeFivbPoolSnakeAssignment(entries, 4, {
      separateSameRegion: true,
      randomFn: makeDeterministicRng(7),
    });

    const poolOf = new Map(res.map((r) => [r.entry.id, r.poolName]));
    // Top 4 seeds go to Pools A, B, C, D
    expect(poolOf.get(1)).toBe('A');
    expect(poolOf.get(2)).toBe('B');
    expect(poolOf.get(3)).toBe('C');
    expect(poolOf.get(4)).toBe('D');

    // The 3 Mojokerto teams should be spread across 3 distinct pools (no 2 in the same pool!)
    const mjkPools = new Set([poolOf.get(1), poolOf.get(5), poolOf.get(6)]);
    expect(mjkPools.size).toBe(3);
  });
});

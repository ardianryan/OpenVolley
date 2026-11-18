import { describe, expect, test } from 'bun:test';
import {
  computeFivbMatchPoints,
  computePoolStandings,
  generateRoundRobinPairs,
} from './pool';

describe('FIVB Pool Standings & Round-Robin Engine', () => {
  test('computeFivbMatchPoints awards 3/0 on 2-0 and 2/1 on 2-1 in Best of 3', () => {
    expect(computeFivbMatchPoints(2, 0, 3)).toEqual({ pointsA: 3, pointsB: 0 });
    expect(computeFivbMatchPoints(2, 1, 3)).toEqual({ pointsA: 2, pointsB: 1 });
    expect(computeFivbMatchPoints(1, 2, 3)).toEqual({ pointsA: 1, pointsB: 2 });
    expect(computeFivbMatchPoints(3, 2, 5)).toEqual({ pointsA: 2, pointsB: 1 });
    expect(computeFivbMatchPoints(3, 1, 5)).toEqual({ pointsA: 3, pointsB: 0 });
  });

  test('generateRoundRobinPairs creates N*(N-1)/2 unique pairings', () => {
    const pairs4 = generateRoundRobinPairs(['A1', 'A2', 'A3', 'A4']);
    expect(pairs4.length).toBe(6);

    const pairs3 = generateRoundRobinPairs(['B1', 'B2', 'B3']);
    expect(pairs3.length).toBe(3);
  });

  test('computePoolStandings resolves Wins -> Match Points -> Set Ratio -> Point Ratio', () => {
    const teams = [
      { id: 1, name: 'Alpha', shortCode: 'ALP', seed: 1, poolName: 'A' },
      { id: 2, name: 'Bravo', shortCode: 'BRV', seed: 2, poolName: 'A' },
      { id: 3, name: 'Charlie', shortCode: 'CHR', seed: 3, poolName: 'A' },
    ];

    // Circular 1-1 tie:
    // Alpha beats Bravo 2-0 (3 pts)
    // Bravo beats Charlie 2-1 (2 pts Bravo, 1 pt Charlie)
    // Charlie beats Alpha 2-1 (2 pts Charlie, 1 pt Alpha)
    // Totals:
    // - Alpha: 1W, 4 pts (3 + 1) -> Rank 1
    // - Charlie: 1W, 3 pts (1 + 2) -> Rank 2
    // - Bravo: 1W, 2 pts (0 + 2) -> Rank 3
    const matches = [
      {
        id: 101,
        bracketType: 'pool' as const,
        poolName: 'A',
        teamAId: 1,
        teamBId: 2,
        winnerId: 1,
        status: 'finished' as const,
        setsWonA: 2,
        setsWonB: 0,
        bestOf: 3,
        sets: [
          { setNumber: 1, scoreA: 25, scoreB: 18, isFinished: true },
          { setNumber: 2, scoreA: 25, scoreB: 20, isFinished: true },
        ],
      },
      {
        id: 102,
        bracketType: 'pool' as const,
        poolName: 'A',
        teamAId: 2,
        teamBId: 3,
        winnerId: 2,
        status: 'finished' as const,
        setsWonA: 2,
        setsWonB: 1,
        bestOf: 3,
        sets: [
          { setNumber: 1, scoreA: 25, scoreB: 22, isFinished: true },
          { setNumber: 2, scoreA: 21, scoreB: 25, isFinished: true },
          { setNumber: 3, scoreA: 15, scoreB: 12, isFinished: true },
        ],
      },
      {
        id: 103,
        bracketType: 'pool' as const,
        poolName: 'A',
        teamAId: 3,
        teamBId: 1,
        winnerId: 3,
        status: 'finished' as const,
        setsWonA: 2,
        setsWonB: 1,
        bestOf: 3,
        sets: [
          { setNumber: 1, scoreA: 25, scoreB: 23, isFinished: true },
          { setNumber: 2, scoreA: 19, scoreB: 25, isFinished: true },
          { setNumber: 3, scoreA: 15, scoreB: 13, isFinished: true },
        ],
      },
    ];

    const standings = computePoolStandings(teams, matches, 3);
    expect(standings.A?.map((r) => r.team.name)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    expect(standings.A?.[0]?.matchPoints).toBe(4);
    expect(standings.A?.[1]?.matchPoints).toBe(3);
    expect(standings.A?.[2]?.matchPoints).toBe(2);
  });
});

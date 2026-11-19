import { describe, expect, it } from 'bun:test';
import type { Match, Team, Tournament } from '../client/types';
import { resolveTournamentPodium } from './podium';

describe('resolveTournamentPodium', () => {
  const dummyTournament: Tournament = {
    id: 1,
    name: 'Turnamen SMP',
    slug: 'turnamen-smp',
    format: 'knockout',
    poolCount: 2,
    advancePerPool: 2,
    bestOf: 3,
    regularSetPoints: 25,
    decidingSetPoints: 15,
    useDeuce: true,
    hasThirdPlace: true,
    status: 'active',
    isEnabled: true,
    sortOrder: 0,
  };

  const dummyTeams: Team[] = [
    { id: 101, tournamentId: 1, name: 'SMPN 1 A', shortCode: 'S1A', color: '#ff0000', seed: 1, isSeeded: false, squadLabel: '', school: '', logoUrl: null, coachName: '', managerName: '', jerseyColors: '[]' },
    { id: 102, tournamentId: 1, name: 'SMPN 2 B', shortCode: 'S2B', color: '#00ff00', seed: 2, isSeeded: false, squadLabel: '', school: '', logoUrl: null, coachName: '', managerName: '', jerseyColors: '[]' },
    { id: 103, tournamentId: 1, name: 'SMPN 3 C', shortCode: 'S3C', color: '#0000ff', seed: 3, isSeeded: false, squadLabel: '', school: '', logoUrl: null, coachName: '', managerName: '', jerseyColors: '[]' },
    { id: 104, tournamentId: 1, name: 'SMPN 4 D', shortCode: 'S4D', color: '#ffff00', seed: 4, isSeeded: false, squadLabel: '', school: '', logoUrl: null, coachName: '', managerName: '', jerseyColors: '[]' },
  ];

  const makeMatch = (patch: Partial<Match>): Match => ({
    id: 1,
    tournamentId: 1,
    round: 1,
    matchIndex: 1,
    bracketType: 'main',
    status: 'finished',
    teamAId: 101,
    teamBId: 102,
    winnerId: 101,
    nextMatchId: null,
    nextMatchSlot: null,
    loserNextMatchId: null,
    loserNextMatchSlot: null,
    servingTeam: null,
    setsWonA: 2,
    setsWonB: 0,
    currentSet: 2,
    courtName: 'Court 1',
    scheduledAt: '',
    sets: [],
    ...patch,
  });

  it('correctly resolves 1st, 2nd, 3rd, and 4th when hasThirdPlace is true', () => {
    const matches: Match[] = [
      makeMatch({ id: 1, round: 1, matchIndex: 1, teamAId: 101, teamBId: 102, winnerId: 101 }),
      makeMatch({ id: 2, round: 1, matchIndex: 2, teamAId: 103, teamBId: 104, winnerId: 104 }),
      makeMatch({ id: 3, round: 2, matchIndex: 1, teamAId: 101, teamBId: 104, winnerId: 101 }),
      makeMatch({ id: 4, round: 2, matchIndex: 1, bracketType: 'third_place', teamAId: 102, teamBId: 103, winnerId: 102 }),
    ];

    const result = resolveTournamentPodium(dummyTournament, matches, dummyTeams);
    expect(result.champion?.name).toBe('SMPN 1 A');
    expect(result.runnerUp?.name).toBe('SMPN 4 D');
    expect(result.thirdPlace?.name).toBe('SMPN 2 B');
    expect(result.fourthPlace?.name).toBe('SMPN 3 C');
    expect(result.isJointThird).toBe(false);
    expect(result.status).toBe('final');
  });

  it('correctly resolves both semifinal losers as Joint 3rd Place when hasThirdPlace is false', () => {
    const noThirdTournament: Tournament = { ...dummyTournament, hasThirdPlace: false };
    const matches: Match[] = [
      makeMatch({ id: 1, round: 1, matchIndex: 1, teamAId: 101, teamBId: 102, winnerId: 101 }),
      makeMatch({ id: 2, round: 1, matchIndex: 2, teamAId: 103, teamBId: 104, winnerId: 104 }),
      makeMatch({ id: 3, round: 2, matchIndex: 1, teamAId: 101, teamBId: 104, winnerId: 104 }),
    ];

    const result = resolveTournamentPodium(noThirdTournament, matches, dummyTeams);
    expect(result.champion?.name).toBe('SMPN 4 D');
    expect(result.runnerUp?.name).toBe('SMPN 1 A');
    expect(result.isJointThird).toBe(true);
    expect(result.fourthPlace).toBeNull();
    expect(result.jointThirdTeams.length).toBe(2);
    expect(result.jointThirdTeams.map((t) => t.name)).toContain('SMPN 2 B');
    expect(result.jointThirdTeams.map((t) => t.name)).toContain('SMPN 3 C');
    expect(result.status).toBe('final');
  });
});

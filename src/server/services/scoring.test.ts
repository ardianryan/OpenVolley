import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, initDatabase } from '../db';
import { matches, teams, tournaments } from '../db/schema';
import {
  addExtraSet,
  addPoint,
  confirmCurrentSet,
  getMatchWithSets,
  startMatch,
  undoLastAction,
} from './scoring';

describe('Scoring Engine', () => {
  let matchId: number;
  let teamAId: number;
  let teamBId: number;

  beforeAll(() => {
    initDatabase();
  });

  beforeEach(async () => {
    await db.delete(tournaments);
    const [t] = await db
      .insert(tournaments)
      .values({
        name: 'Custom Tarkam Bo3',
        slug: `tarkam-${Date.now()}-${Math.random()}`,
        isEnabled: true,
        status: 'active',
        bestOf: 3,
        regularSetPoints: 5,
        decidingSetPoints: 3,
        useDeuce: true,
        hasThirdPlace: false,
        sortOrder: 1,
        createdAt: Date.now(),
      })
      .returning();

    const [ta] = await db
      .insert(teams)
      .values({ tournamentId: t.id, name: 'Team A', shortCode: 'TMA', seed: 1 })
      .returning();
    const [tb] = await db
      .insert(teams)
      .values({ tournamentId: t.id, name: 'Team B', shortCode: 'TMB', seed: 2 })
      .returning();

    teamAId = ta.id;
    teamBId = tb.id;

    const [m] = await db
      .insert(matches)
      .values({
        tournamentId: t.id,
        round: 1,
        matchIndex: 0,
        bracketType: 'main',
        teamAId,
        teamBId,
        status: 'scheduled',
      })
      .returning();
    matchId = m.id;
  });

  test('requires explicit confirmation on set point, handles deuce, and advances sets', async () => {
    await startMatch(matchId);

    // Bring Set 1 to 4-4
    for (let i = 0; i < 4; i++) {
      await addPoint(matchId, 'A', 1);
      await addPoint(matchId, 'B', 1);
    }

    // 5-4 should NOT trigger pendingDecision because deuce requires diff >= 2
    let state = await addPoint(matchId, 'A', 1);
    expect((state as { pendingDecision?: unknown }).pendingDecision).toBeUndefined();

    // 6-4 triggers pendingDecision (does NOT auto-close set without confirmation)
    state = await addPoint(matchId, 'A', 1);
    expect((state as { pendingDecision?: { willWinMatch: boolean } }).pendingDecision).toBeDefined();
    expect(state!.currentSet).toBe(1);

    // Referee confirms closing Set 1 and continuing to Set 2
    state = await confirmCurrentSet(matchId, 'next_set');
    expect(state!.setsWonA).toBe(1);
    expect(state!.currentSet).toBe(2);

    // Team B wins Set 2 (5-0) and confirms next set (Set 3 deciding)
    for (let i = 0; i < 5; i++) {
      state = await addPoint(matchId, 'B', 1);
    }
    expect((state as { pendingDecision?: unknown }).pendingDecision).toBeDefined();
    state = await confirmCurrentSet(matchId, 'next_set');
    expect(state!.setsWonB).toBe(1);
    expect(state!.currentSet).toBe(3);

    // Deciding set target is 3: Team A scores 3-0 -> willWinMatch: true -> confirms finish
    for (let i = 0; i < 3; i++) {
      state = await addPoint(matchId, 'A', 1);
    }
    expect((state as { pendingDecision?: { willWinMatch: boolean } }).pendingDecision?.willWinMatch).toBe(true);

    state = await confirmCurrentSet(matchId, 'finish_match');
    expect(state!.status).toBe('finished');
    expect(state!.winnerId).toBe(teamAId);

    // Referee can still add 1 extra set if desired
    state = await addExtraSet(matchId);
    expect(state!.status).toBe('live');
    expect(state!.currentSet).toBe(4);
  });

  test('undoLastAction reverts confirmed set transition', async () => {
    await startMatch(matchId);
    for (let i = 0; i < 5; i++) {
      await addPoint(matchId, 'A', 1);
    }
    await confirmCurrentSet(matchId, 'next_set');

    let state = await getMatchWithSets(matchId);
    expect(state!.setsWonA).toBe(1);
    expect(state!.currentSet).toBe(2);

    state = await undoLastAction(matchId);
    expect(state!.setsWonA).toBe(0);
    expect(state!.currentSet).toBe(1);
  });

  test('startMatch accepts per-match local rule override (e.g. 15 pts for QF)', async () => {
    await startMatch(matchId, {
      bestOf: 3,
      regularSetPoints: 15,
      decidingSetPoints: 15,
      useDeuce: true,
    });

    for (let i = 0; i < 14; i++) {
      await addPoint(matchId, 'A', 1);
    }
    let state = await addPoint(matchId, 'A', 1);
    expect((state as { pendingDecision?: { setNumber: number } }).pendingDecision?.setNumber).toBe(1);
  });
});

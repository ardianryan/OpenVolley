import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { matchSets, matches, tournaments } from '../db/schema';
import { advanceWinner } from './bracket';

interface ScoreSnapshot {
  currentSet: number;
  setsWonA: number;
  setsWonB: number;
  servingTeam: 'A' | 'B' | null;
  status: 'scheduled' | 'live' | 'finished' | 'bye';
  winnerId: number | null;
  sets: Array<{
    setNumber: number;
    scoreA: number;
    scoreB: number;
    timeoutsA: number;
    timeoutsB: number;
    subsA: number;
    subsB: number;
    isFinished: boolean;
    winnerId: number | null;
  }>;
}

const undoStacks = new Map<number, ScoreSnapshot[]>();
const MAX_UNDO_STEPS = 12;

export const MAX_TIMEOUTS_PER_SET = 2;
export const MAX_SUBS_PER_SET = 6;

async function pushUndoSnapshot(matchId: number) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) return;

  const sets = await db
    .select()
    .from(matchSets)
    .where(eq(matchSets.matchId, matchId))
    .orderBy(asc(matchSets.setNumber));

  const stack = undoStacks.get(matchId) ?? [];
  stack.push({
    currentSet: match.currentSet,
    setsWonA: match.setsWonA,
    setsWonB: match.setsWonB,
    servingTeam: match.servingTeam,
    status: match.status,
    winnerId: match.winnerId,
    sets: sets.map((s) => ({
      setNumber: s.setNumber,
      scoreA: s.scoreA,
      scoreB: s.scoreB,
      timeoutsA: s.timeoutsA ?? 0,
      timeoutsB: s.timeoutsB ?? 0,
      subsA: s.subsA ?? 0,
      subsB: s.subsB ?? 0,
      isFinished: s.isFinished,
      winnerId: s.winnerId,
    })),
  });

  if (stack.length > MAX_UNDO_STEPS) {
    stack.shift();
  }
  undoStacks.set(matchId, stack);
}

export interface MatchRulesOverride {
  bestOf?: number;
  regularSetPoints?: number;
  decidingSetPoints?: number;
  useDeuce?: boolean;
}

export function getUndoCount(matchId: number): number {
  return undoStacks.get(matchId)?.length ?? 0;
}

export async function startMatch(matchId: number, rules?: MatchRulesOverride) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) throw new Error('Pertandingan tidak ditemukan');
  if (!match.teamAId || !match.teamBId) {
    throw new Error('Kedua tim harus terisi sebelum memulai pertandingan');
  }

  const existingSets = await db
    .select()
    .from(matchSets)
    .where(eq(matchSets.matchId, matchId));

  if (existingSets.length === 0) {
    await db.insert(matchSets).values({
      matchId,
      setNumber: 1,
      scoreA: 0,
      scoreB: 0,
      timeoutsA: 0,
      timeoutsB: 0,
      subsA: 0,
      subsB: 0,
      isFinished: false,
    });
  }

  const updateFields: Partial<typeof matches.$inferInsert> = {
    status: 'live',
    servingTeam: match.servingTeam ?? 'A',
  };

  if (rules) {
    if (rules.bestOf === 1 || rules.bestOf === 3 || rules.bestOf === 5) {
      updateFields.bestOf = rules.bestOf;
    }
    if (rules.regularSetPoints && rules.regularSetPoints >= 5) {
      updateFields.regularSetPoints = rules.regularSetPoints;
    }
    if (rules.decidingSetPoints && rules.decidingSetPoints >= 5) {
      updateFields.decidingSetPoints = rules.decidingSetPoints;
    }
    if (rules.useDeuce !== undefined) updateFields.useDeuce = rules.useDeuce;
  }

  await db.update(matches).set(updateFields).where(eq(matches.id, matchId));

  return getMatchWithSets(matchId);
}

export async function addPoint(matchId: number, team: 'A' | 'B', delta: 1 | -1) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) throw new Error('Pertandingan tidak ditemukan');
  if (match.status === 'finished' || match.status === 'bye') {
    throw new Error('Pertandingan sudah selesai');
  }

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });
  if (!tournament) throw new Error('Turnamen tidak ditemukan');

  if (match.status === 'scheduled') {
    await startMatch(matchId);
  }

  await pushUndoSnapshot(matchId);

  const refreshedMatch = (await db.query.matches.findFirst({ where: eq(matches.id, matchId) }))!;
  let activeSet = await db.query.matchSets.findFirst({
    where: and(
      eq(matchSets.matchId, matchId),
      eq(matchSets.setNumber, refreshedMatch.currentSet)
    ),
  });

  if (!activeSet) {
    const [inserted] = await db
      .insert(matchSets)
      .values({
        matchId,
        setNumber: refreshedMatch.currentSet,
        scoreA: 0,
        scoreB: 0,
        timeoutsA: 0,
        timeoutsB: 0,
        subsA: 0,
        subsB: 0,
        isFinished: false,
      })
      .returning();
    activeSet = inserted;
  }

  const newScoreA = Math.max(0, activeSet!.scoreA + (team === 'A' ? delta : 0));
  const newScoreB = Math.max(0, activeSet!.scoreB + (team === 'B' ? delta : 0));

  await db
    .update(matchSets)
    .set({ scoreA: newScoreA, scoreB: newScoreB })
    .where(eq(matchSets.id, activeSet!.id));

  if (delta > 0) {
    await db
      .update(matches)
      .set({ servingTeam: team })
      .where(eq(matches.id, matchId));
  }

  const effectiveBestOf = refreshedMatch.bestOf ?? tournament.bestOf;
  const effectiveRegular = refreshedMatch.regularSetPoints ?? tournament.regularSetPoints;
  const effectiveDeciding = refreshedMatch.decidingSetPoints ?? tournament.decidingSetPoints;
  const effectiveDeuce = refreshedMatch.useDeuce ?? tournament.useDeuce;

  const isDecidingSet = refreshedMatch.currentSet === effectiveBestOf;
  const targetPoints = isDecidingSet ? effectiveDeciding : effectiveRegular;

  const diff = Math.abs(newScoreA - newScoreB);
  const reachedTarget = newScoreA >= targetPoints || newScoreB >= targetPoints;
  const deuceSatisfied = !effectiveDeuce || diff >= 2;

  const state = await getMatchWithSets(matchId);
  if (delta > 0 && reachedTarget && deuceSatisfied && newScoreA !== newScoreB) {
    const leadingSide: 'A' | 'B' = newScoreA > newScoreB ? 'A' : 'B';
    const projectedSetsA = refreshedMatch.setsWonA + (leadingSide === 'A' ? 1 : 0);
    const projectedSetsB = refreshedMatch.setsWonB + (leadingSide === 'B' ? 1 : 0);
    const setsNeededToWin = Math.ceil(effectiveBestOf / 2);

    return {
      ...state!,
      pendingDecision: {
        setNumber: refreshedMatch.currentSet,
        scoreA: newScoreA,
        scoreB: newScoreB,
        leadingSide,
        willWinMatch:
          projectedSetsA >= setsNeededToWin || projectedSetsB >= setsNeededToWin,
      },
    };
  }

  return state;
}

export async function adjustSetCounter(
  matchId: number,
  kind: 'timeout' | 'sub',
  team: 'A' | 'B',
  delta: 1 | -1
) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) throw new Error('Pertandingan tidak ditemukan');
  if (match.status !== 'live') {
    throw new Error('Pertandingan harus berstatus LIVE untuk mencatat timeout/substitusi');
  }

  const activeSet = await db.query.matchSets.findFirst({
    where: and(
      eq(matchSets.matchId, matchId),
      eq(matchSets.setNumber, match.currentSet)
    ),
  });
  if (!activeSet) throw new Error('Set aktif tidak ditemukan');

  const maxCap = kind === 'timeout' ? MAX_TIMEOUTS_PER_SET : MAX_SUBS_PER_SET;
  const curVal =
    kind === 'timeout'
      ? team === 'A'
        ? activeSet.timeoutsA
        : activeSet.timeoutsB
      : team === 'A'
        ? activeSet.subsA
        : activeSet.subsB;

  const nextVal = Math.max(0, Math.min(maxCap, curVal + delta));
  if (nextVal === curVal) {
    return getMatchWithSets(matchId);
  }

  await pushUndoSnapshot(matchId);

  const patch: Partial<typeof matchSets.$inferInsert> =
    kind === 'timeout'
      ? team === 'A'
        ? { timeoutsA: nextVal }
        : { timeoutsB: nextVal }
      : team === 'A'
        ? { subsA: nextVal }
        : { subsB: nextVal };

  await db.update(matchSets).set(patch).where(eq(matchSets.id, activeSet.id));
  return getMatchWithSets(matchId);
}

export async function confirmCurrentSet(
  matchId: number,
  mode: 'next_set' | 'finish_match'
) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) throw new Error('Pertandingan tidak ditemukan');

  const activeSet = await db.query.matchSets.findFirst({
    where: and(
      eq(matchSets.matchId, matchId),
      eq(matchSets.setNumber, match.currentSet)
    ),
  });
  if (!activeSet) throw new Error('Set aktif tidak ditemukan');
  if (activeSet.scoreA === activeSet.scoreB) {
    throw new Error('Skor set masih imbang, belum bisa menentukan pemenang set');
  }

  await pushUndoSnapshot(matchId);

  const setWinnerSide: 'A' | 'B' = activeSet.scoreA > activeSet.scoreB ? 'A' : 'B';
  const setWinnerId = setWinnerSide === 'A' ? match.teamAId : match.teamBId;

  await db
    .update(matchSets)
    .set({ isFinished: true, winnerId: setWinnerId })
    .where(eq(matchSets.id, activeSet.id));

  const newSetsWonA = match.setsWonA + (setWinnerSide === 'A' ? 1 : 0);
  const newSetsWonB = match.setsWonB + (setWinnerSide === 'B' ? 1 : 0);

  if (mode === 'finish_match') {
    const matchWinnerId = newSetsWonA >= newSetsWonB ? match.teamAId : match.teamBId;
    await db
      .update(matches)
      .set({
        setsWonA: newSetsWonA,
        setsWonB: newSetsWonB,
        status: 'finished',
        winnerId: matchWinnerId,
      })
      .where(eq(matches.id, matchId));

    await advanceWinner(matchId);
  } else {
    const nextSetNum = match.currentSet + 1;
    await db
      .update(matches)
      .set({
        setsWonA: newSetsWonA,
        setsWonB: newSetsWonB,
        currentSet: nextSetNum,
        status: 'live',
        winnerId: null,
      })
      .where(eq(matches.id, matchId));

    await db.insert(matchSets).values({
      matchId,
      setNumber: nextSetNum,
      scoreA: 0,
      scoreB: 0,
      timeoutsA: 0,
      timeoutsB: 0,
      subsA: 0,
      subsB: 0,
      isFinished: false,
    });
  }

  return getMatchWithSets(matchId);
}

export async function undoLastAction(matchId: number) {
  const stack = undoStacks.get(matchId);
  if (!stack || stack.length === 0) {
    throw new Error('Tidak ada aksi untuk di-undo');
  }

  const snapshot = stack.pop()!;
  await db
    .update(matches)
    .set({
      currentSet: snapshot.currentSet,
      setsWonA: snapshot.setsWonA,
      setsWonB: snapshot.setsWonB,
      servingTeam: snapshot.servingTeam,
      status: snapshot.status,
      winnerId: snapshot.winnerId,
    })
    .where(eq(matches.id, matchId));

  await db.delete(matchSets).where(eq(matchSets.matchId, matchId));
  for (const s of snapshot.sets) {
    await db.insert(matchSets).values({
      matchId,
      setNumber: s.setNumber,
      scoreA: s.scoreA,
      scoreB: s.scoreB,
      timeoutsA: s.timeoutsA ?? 0,
      timeoutsB: s.timeoutsB ?? 0,
      subsA: s.subsA ?? 0,
      subsB: s.subsB ?? 0,
      isFinished: s.isFinished,
      winnerId: s.winnerId,
    });
  }

  return getMatchWithSets(matchId);
}

export async function setServingTeam(matchId: number, team: 'A' | 'B') {
  await db.update(matches).set({ servingTeam: team }).where(eq(matches.id, matchId));
  return getMatchWithSets(matchId);
}

export async function finishMatchManually(matchId: number, winnerSide: 'A' | 'B') {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) throw new Error('Pertandingan tidak ditemukan');

  const winnerId = winnerSide === 'A' ? match.teamAId : match.teamBId;
  if (!winnerId) throw new Error('Tim pemenang tidak valid');

  await pushUndoSnapshot(matchId);

  await db
    .update(matches)
    .set({
      status: 'finished',
      winnerId,
    })
    .where(eq(matches.id, matchId));

  await advanceWinner(matchId);
  return getMatchWithSets(matchId);
}

export async function addExtraSet(matchId: number) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) throw new Error('Pertandingan tidak ditemukan');

  await pushUndoSnapshot(matchId);

  const existingSets = await db
    .select()
    .from(matchSets)
    .where(eq(matchSets.matchId, matchId))
    .orderBy(asc(matchSets.setNumber));

  const nextSetNum =
    existingSets.length > 0
      ? Math.max(...existingSets.map((s) => s.setNumber)) + 1
      : match.currentSet + 1;

  if (match.winnerId && match.nextMatchId && match.nextMatchSlot) {
    const clearField =
      match.nextMatchSlot === 'A' ? { teamAId: null } : { teamBId: null };
    await db.update(matches).set(clearField).where(eq(matches.id, match.nextMatchId));
  }
  if (match.winnerId && match.loserNextMatchId && match.loserNextMatchSlot) {
    const clearLoser =
      match.loserNextMatchSlot === 'A' ? { teamAId: null } : { teamBId: null };
    await db
      .update(matches)
      .set(clearLoser)
      .where(eq(matches.id, match.loserNextMatchId));
  }

  await db
    .update(matches)
    .set({
      status: 'live',
      winnerId: null,
      currentSet: nextSetNum,
    })
    .where(eq(matches.id, matchId));

  await db.insert(matchSets).values({
    matchId,
    setNumber: nextSetNum,
    scoreA: 0,
    scoreB: 0,
    timeoutsA: 0,
    timeoutsB: 0,
    subsA: 0,
    subsB: 0,
    isFinished: false,
  });

  return getMatchWithSets(matchId);
}

export async function resetMatchScore(matchId: number) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) throw new Error('Pertandingan tidak ditemukan');

  undoStacks.delete(matchId);
  await db.delete(matchSets).where(eq(matchSets.matchId, matchId));
  await db
    .update(matches)
    .set({
      status: 'scheduled',
      setsWonA: 0,
      setsWonB: 0,
      currentSet: 1,
      winnerId: null,
      servingTeam: null,
    })
    .where(eq(matches.id, matchId));

  return getMatchWithSets(matchId);
}

export async function getMatchWithSets(matchId: number) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) return null;

  const sets = await db
    .select()
    .from(matchSets)
    .where(eq(matchSets.matchId, matchId))
    .orderBy(asc(matchSets.setNumber));

  return {
    ...match,
    sets,
    undoCount: getUndoCount(matchId),
  };
}

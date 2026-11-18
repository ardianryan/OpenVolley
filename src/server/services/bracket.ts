import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { matches, teams, tournaments } from '../db/schema';

/**
 * Generates standard tournament seeding order so top seeds are separated
 * and BYEs are awarded to highest seeds without double-bye collisions.
 * Example n=8 -> [1, 8, 4, 5, 2, 7, 3, 6]
 */
export function buildSeedOrder(bracketSize: number): number[] {
  let order = [1, 2];
  while (order.length < bracketSize) {
    const nextSize = order.length * 2;
    const nextOrder: number[] = [];
    for (const seed of order) {
      nextOrder.push(seed, nextSize + 1 - seed);
    }
    order = nextOrder;
  }
  return order;
}

export async function generateBracket(tournamentId: number, shuffle = false) {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });
  if (!tournament) {
    throw new Error('Turnamen tidak ditemukan');
  }

  let teamList = await db
    .select()
    .from(teams)
    .where(eq(teams.tournamentId, tournamentId))
    .orderBy(asc(teams.seed), asc(teams.id));

  if (teamList.length < 2) {
    throw new Error('Minimal 2 tim diperlukan untuk membuat bagan');
  }

  if (shuffle) {
    teamList = [...teamList].sort(() => Math.random() - 0.5);
    for (let i = 0; i < teamList.length; i++) {
      await db.update(teams).set({ seed: i + 1 }).where(eq(teams.id, teamList[i].id));
    }
  }

  // Clear existing matches (cascades to match_sets and match_reports)
  await db.delete(matches).where(eq(matches.tournamentId, tournamentId));

  const teamCount = teamList.length;
  const totalRounds = Math.ceil(Math.log2(teamCount));
  const bracketSize = Math.pow(2, totalRounds);
  const seedOrder = buildSeedOrder(bracketSize);

  // Store created match IDs by [round][matchIndex]
  const roundMatchIds: Record<number, number[]> = {};

  // 1. Create matches from Final (totalRounds) down to Round 1
  for (let round = totalRounds; round >= 1; round--) {
    const matchCountInRound = Math.pow(2, totalRounds - round);
    roundMatchIds[round] = [];

    for (let idx = 0; idx < matchCountInRound; idx++) {
      let nextMatchId: number | null = null;
      let nextMatchSlot: 'A' | 'B' | null = null;

      if (round < totalRounds) {
        const parentIdx = Math.floor(idx / 2);
        nextMatchId = roundMatchIds[round + 1][parentIdx];
        nextMatchSlot = idx % 2 === 0 ? 'A' : 'B';
      }

      const [inserted] = await db
        .insert(matches)
        .values({
          tournamentId,
          round,
          matchIndex: idx,
          bracketType: 'main',
          nextMatchId,
          nextMatchSlot,
          status: 'scheduled',
          courtName: `Court ${(idx % 2) + 1}`,
        })
        .returning({ id: matches.id });

      roundMatchIds[round].push(inserted.id);
    }
  }

  // 2. Optional 3rd Place Match (when at least 4 teams / >= 2 rounds)
  if (tournament.hasThirdPlace && totalRounds >= 2) {
    const [thirdPlace] = await db
      .insert(matches)
      .values({
        tournamentId,
        round: totalRounds,
        matchIndex: 1,
        bracketType: 'third_place',
        status: 'scheduled',
        courtName: 'Court 1',
      })
      .returning({ id: matches.id });

    const semiRound = totalRounds - 1;
    const semiIds = roundMatchIds[semiRound];
    if (semiIds && semiIds.length === 2) {
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'A' })
        .where(eq(matches.id, semiIds[0]));
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'B' })
        .where(eq(matches.id, semiIds[1]));
    }
  }

  // 3. Assign teams to Round 1 and resolve auto-byes
  const r1Ids = roundMatchIds[1];
  for (let idx = 0; idx < r1Ids.length; idx++) {
    const seedA = seedOrder[idx * 2];
    const seedB = seedOrder[idx * 2 + 1];
    const teamA = teamList[seedA - 1] ?? null;
    const teamB = teamList[seedB - 1] ?? null;

    const matchId = r1Ids[idx];
    await db
      .update(matches)
      .set({
        teamAId: teamA?.id ?? null,
        teamBId: teamB?.id ?? null,
      })
      .where(eq(matches.id, matchId));

    // Handle single-sided BYE
    if (teamA && !teamB) {
      await db
        .update(matches)
        .set({ status: 'bye', winnerId: teamA.id })
        .where(eq(matches.id, matchId));
      await advanceWinner(matchId);
    } else if (!teamA && teamB) {
      await db
        .update(matches)
        .set({ status: 'bye', winnerId: teamB.id })
        .where(eq(matches.id, matchId));
      await advanceWinner(matchId);
    }
  }

  return await db
    .select()
    .from(matches)
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matches.round), asc(matches.matchIndex));
}

/**
 * Initializes a Technical Meeting / Drawing bracket with N placeholder slots
 * (4, 8, or 16 teams) paired sequentially: Undian 01 vs 02 -> M1, 03 vs 04 -> M2, etc.
 * Pool A = left half, Pool B = right half.
 */
export async function initializeDrawBracket(
  tournamentId: number,
  slotCount: 4 | 8 | 16 = 16
) {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });
  if (!tournament) {
    throw new Error('Turnamen tidak ditemukan');
  }

  await db.delete(matches).where(eq(matches.tournamentId, tournamentId));
  await db.delete(teams).where(eq(teams.tournamentId, tournamentId));

  const createdTeams: Array<{ id: number; seed: number }> = [];
  for (let i = 1; i <= slotCount; i++) {
    const num = String(i).padStart(2, '0');
    const [tm] = await db
      .insert(teams)
      .values({
        tournamentId,
        name: `[ Undian ${num} ]`,
        shortCode: `U${num}`,
        school: '',
        color: i <= slotCount / 2 ? '#E09D17' : '#3B82F6',
        seed: i,
      })
      .returning({ id: teams.id, seed: teams.seed });
    createdTeams.push(tm);
  }

  const totalRounds = Math.log2(slotCount);
  const roundMatchIds: Record<number, number[]> = {};

  for (let round = totalRounds; round >= 1; round--) {
    const matchCountInRound = Math.pow(2, totalRounds - round);
    roundMatchIds[round] = [];

    for (let idx = 0; idx < matchCountInRound; idx++) {
      let nextMatchId: number | null = null;
      let nextMatchSlot: 'A' | 'B' | null = null;

      if (round < totalRounds) {
        const parentIdx = Math.floor(idx / 2);
        nextMatchId = roundMatchIds[round + 1][parentIdx];
        nextMatchSlot = idx % 2 === 0 ? 'A' : 'B';
      }

      const isPoolB = idx >= matchCountInRound / 2 && round < totalRounds;
      const courtName =
        round === totalRounds
          ? 'Lapangan 1 (Utama)'
          : isPoolB
            ? 'Lapangan 2'
            : 'Lapangan 1 (Utama)';

      const [inserted] = await db
        .insert(matches)
        .values({
          tournamentId,
          round,
          matchIndex: idx,
          bracketType: 'main',
          nextMatchId,
          nextMatchSlot,
          status: 'scheduled',
          courtName,
        })
        .returning({ id: matches.id });

      roundMatchIds[round].push(inserted.id);
    }
  }

  if (tournament.hasThirdPlace && totalRounds >= 2) {
    const [thirdPlace] = await db
      .insert(matches)
      .values({
        tournamentId,
        round: totalRounds,
        matchIndex: 1,
        bracketType: 'third_place',
        status: 'scheduled',
        courtName: 'Lapangan 1 (Utama)',
      })
      .returning({ id: matches.id });

    const semiIds = roundMatchIds[totalRounds - 1];
    if (semiIds && semiIds.length === 2) {
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'A' })
        .where(eq(matches.id, semiIds[0]));
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'B' })
        .where(eq(matches.id, semiIds[1]));
    }
  }

  // Pair Undian 01 vs 02, 03 vs 04, ... into Round 1
  const r1Ids = roundMatchIds[1];
  for (let idx = 0; idx < r1Ids.length; idx++) {
    const teamA = createdTeams[idx * 2];
    const teamB = createdTeams[idx * 2 + 1];
    await db
      .update(matches)
      .set({ teamAId: teamA.id, teamBId: teamB.id })
      .where(eq(matches.id, r1Ids[idx]));
  }

  return await db
    .select()
    .from(matches)
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matches.round), asc(matches.matchIndex));
}

export async function advanceWinner(matchId: number) {
  const match = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
  });
  if (!match || !match.winnerId) return;

  if (match.nextMatchId && match.nextMatchSlot) {
    const updateField =
      match.nextMatchSlot === 'A'
        ? { teamAId: match.winnerId }
        : { teamBId: match.winnerId };

    await db.update(matches).set(updateField).where(eq(matches.id, match.nextMatchId));
  }

  if (match.loserNextMatchId && match.loserNextMatchSlot && match.teamAId && match.teamBId) {
    const loserId = match.winnerId === match.teamAId ? match.teamBId : match.teamAId;
    const loserField =
      match.loserNextMatchSlot === 'A' ? { teamAId: loserId } : { teamBId: loserId };

    await db.update(matches).set(loserField).where(eq(matches.id, match.loserNextMatchId));
  }
}

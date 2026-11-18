import { asc, eq, inArray } from 'drizzle-orm';
import { computePoolStandings, generateRoundRobinPairs } from '../../shared/pool';
import { db } from '../db';
import { matchSets, matches, teams, tournaments } from '../db/schema';

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
      await db.update(teams).set({ seed: i + 1 }).where(eq(teams.id, teamList[i]!.id));
    }
  }

  // Clear existing matches (cascades to match_sets and match_reports)
  await db.delete(matches).where(eq(matches.tournamentId, tournamentId));

  const teamCount = teamList.length;
  const totalRounds = Math.ceil(Math.log2(teamCount));
  const bracketSize = Math.pow(2, totalRounds);
  const seedOrder = buildSeedOrder(bracketSize);

  const roundMatchIds: Record<number, number[]> = {};

  for (let round = totalRounds; round >= 1; round--) {
    const matchCountInRound = Math.pow(2, totalRounds - round);
    roundMatchIds[round] = [];

    for (let idx = 0; idx < matchCountInRound; idx++) {
      let nextMatchId: number | null = null;
      let nextMatchSlot: 'A' | 'B' | null = null;

      if (round < totalRounds) {
        const parentIdx = Math.floor(idx / 2);
        nextMatchId = roundMatchIds[round + 1]![parentIdx]!;
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

      roundMatchIds[round]!.push(inserted!.id);
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
        courtName: 'Court 1',
      })
      .returning({ id: matches.id });

    const semiRound = totalRounds - 1;
    const semiIds = roundMatchIds[semiRound];
    if (semiIds && semiIds.length === 2 && thirdPlace) {
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'A' })
        .where(eq(matches.id, semiIds[0]!));
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'B' })
        .where(eq(matches.id, semiIds[1]!));
    }
  }

  const r1Ids = roundMatchIds[1]!;
  for (let idx = 0; idx < r1Ids.length; idx++) {
    const seedA = seedOrder[idx * 2]!;
    const seedB = seedOrder[idx * 2 + 1]!;
    const teamA = teamList[seedA - 1] ?? null;
    const teamB = teamList[seedB - 1] ?? null;

    const matchId = r1Ids[idx]!;
    await db
      .update(matches)
      .set({
        teamAId: teamA?.id ?? null,
        teamBId: teamB?.id ?? null,
      })
      .where(eq(matches.id, matchId));

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
    createdTeams.push(tm!);
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
        nextMatchId = roundMatchIds[round + 1]![parentIdx]!;
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

      roundMatchIds[round]!.push(inserted!.id);
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
    if (semiIds && semiIds.length === 2 && thirdPlace) {
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'A' })
        .where(eq(matches.id, semiIds[0]!));
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'B' })
        .where(eq(matches.id, semiIds[1]!));
    }
  }

  const r1Ids = roundMatchIds[1]!;
  for (let idx = 0; idx < r1Ids.length; idx++) {
    const teamA = createdTeams[idx * 2]!;
    const teamB = createdTeams[idx * 2 + 1]!;
    await db
      .update(matches)
      .set({ teamAId: teamA.id, teamBId: teamB.id })
      .where(eq(matches.id, r1Ids[idx]!));
  }

  return await db
    .select()
    .from(matches)
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matches.round), asc(matches.matchIndex));
}

/**
 * Generates Pool Stage (Round-Robin) fixtures + Stage II Knockout Skeleton
 * (modeled after POPDA/PBVSI two-stage competitions).
 */
export async function generatePoolStageBracket(
  tournamentId: number,
  options?: { poolCount?: number; advancePerPool?: number; shuffle?: boolean }
) {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });
  if (!tournament) throw new Error('Turnamen tidak ditemukan');

  let teamList = await db
    .select()
    .from(teams)
    .where(eq(teams.tournamentId, tournamentId))
    .orderBy(asc(teams.seed), asc(teams.id));

  if (teamList.length < 4) {
    throw new Error('Minimal 4 tim diperlukan untuk membuat Fase Pool');
  }

  const poolCount = Math.max(
    2,
    Math.min(8, options?.poolCount ?? tournament.poolCount ?? 2)
  );
  const advancePerPool = Math.max(
    1,
    Math.min(2, options?.advancePerPool ?? tournament.advancePerPool ?? 2)
  );

  await db
    .update(tournaments)
    .set({ format: 'pool_knockout', poolCount, advancePerPool })
    .where(eq(tournaments.id, tournamentId));

  if (options?.shuffle) {
    teamList = [...teamList].sort(() => Math.random() - 0.5);
  }

  const poolLetters = Array.from({ length: poolCount }, (_, i) =>
    String.fromCharCode(65 + i)
  );

  // Snake-distribute teams across pools unless all teams already have valid pool letters
  const allHaveValidPools = teamList.every(
    (t) => t.poolName && poolLetters.includes(t.poolName.toUpperCase())
  );

  const grouped = new Map<string, typeof teamList>();
  for (const letter of poolLetters) grouped.set(letter, []);

  if (allHaveValidPools && !options?.shuffle) {
    for (const t of teamList) {
      const letter = t.poolName!.toUpperCase();
      grouped.get(letter)!.push(t);
    }
  } else {
    for (let idx = 0; idx < teamList.length; idx++) {
      const row = Math.floor(idx / poolCount);
      const col = idx % poolCount;
      const poolIdx = row % 2 === 0 ? col : poolCount - 1 - col;
      const letter = poolLetters[poolIdx]!;
      const t = teamList[idx]!;
      await db
        .update(teams)
        .set({ poolName: letter, seed: idx + 1 })
        .where(eq(teams.id, t.id));
      grouped.get(letter)!.push({ ...t, poolName: letter, seed: idx + 1 });
    }
  }

  // Clear existing matches before generating Pool + Stage II Knockout
  await db.delete(matches).where(eq(matches.tournamentId, tournamentId));

  // 1. Insert Round-Robin Pool Matches
  let globalPoolMatchIdx = 0;
  for (const letter of poolLetters) {
    const members = grouped.get(letter) ?? [];
    const pairs = generateRoundRobinPairs(members);
    for (const p of pairs) {
      await db.insert(matches).values({
        tournamentId,
        round: p.round,
        matchIndex: globalPoolMatchIdx,
        bracketType: 'pool',
        poolName: letter,
        stageLabel: `Pool ${letter}`,
        teamAId: p.a.id,
        teamBId: p.b.id,
        status: 'scheduled',
        courtName: `Lapangan ${(globalPoolMatchIdx % 2) + 1}`,
      });
      globalPoolMatchIdx++;
    }
  }

  // 2. Build Stage II Knockout Bracket Skeleton with Cross-Pool Placeholders
  const qualifiedTarget = Math.max(2, poolCount * advancePerPool);
  const koRounds = Math.ceil(Math.log2(qualifiedTarget));
  const koBracketSize = Math.pow(2, koRounds);
  const seedOrder = buildSeedOrder(koBracketSize);

  // Build placeholder labels for seed 1..koBracketSize (R1..Rk, RU1..RUk)
  const seedPlaceholders: string[] = [];
  for (let p = 0; p < poolCount; p++) {
    seedPlaceholders.push(`Winner Pool ${poolLetters[p]}`);
  }
  if (advancePerPool >= 2) {
    // Reverse runner-up order so Pool A winner meets opposite pool runner-up
    for (let p = poolCount - 1; p >= 0; p--) {
      seedPlaceholders.push(`Runner-Up Pool ${poolLetters[p]}`);
    }
  }

  const roundMatchIds: Record<number, number[]> = {};
  for (let round = koRounds; round >= 1; round--) {
    const matchCountInRound = Math.pow(2, koRounds - round);
    roundMatchIds[round] = [];

    for (let idx = 0; idx < matchCountInRound; idx++) {
      let nextMatchId: number | null = null;
      let nextMatchSlot: 'A' | 'B' | null = null;
      if (round < koRounds) {
        const parentIdx = Math.floor(idx / 2);
        nextMatchId = roundMatchIds[round + 1]![parentIdx]!;
        nextMatchSlot = idx % 2 === 0 ? 'A' : 'B';
      }

      let stageLabel: string | null = null;
      if (round === 1) {
        const sA = seedOrder[idx * 2]!;
        const sB = seedOrder[idx * 2 + 1]!;
        const labelA = seedPlaceholders[sA - 1] || 'BYE';
        const labelB = seedPlaceholders[sB - 1] || 'BYE';
        stageLabel = `${labelA} vs ${labelB}`;
      }

      const [inserted] = await db
        .insert(matches)
        .values({
          tournamentId,
          round,
          matchIndex: idx,
          bracketType: 'main',
          stageLabel,
          nextMatchId,
          nextMatchSlot,
          status: 'scheduled',
          courtName: `Lapangan ${(idx % 2) + 1}`,
        })
        .returning({ id: matches.id });

      roundMatchIds[round]!.push(inserted!.id);
    }
  }

  if (tournament.hasThirdPlace && koRounds >= 2) {
    const [thirdPlace] = await db
      .insert(matches)
      .values({
        tournamentId,
        round: koRounds,
        matchIndex: 1,
        bracketType: 'third_place',
        stageLabel: '3rd Place Match',
        status: 'scheduled',
        courtName: 'Court 1',
      })
      .returning({ id: matches.id });

    const semiIds = roundMatchIds[koRounds - 1];
    if (semiIds && semiIds.length === 2 && thirdPlace) {
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'A' })
        .where(eq(matches.id, semiIds[0]!));
      await db
        .update(matches)
        .set({ loserNextMatchId: thirdPlace.id, loserNextMatchSlot: 'B' })
        .where(eq(matches.id, semiIds[1]!));
    }
  }

  return await db
    .select()
    .from(matches)
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matches.round), asc(matches.matchIndex));
}

/**
 * Evaluates live FIVB Pool Standings and populates Stage II Knockout Round 1 slots.
 */
export async function advancePoolsToKnockout(tournamentId: number) {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });
  if (!tournament) throw new Error('Turnamen tidak ditemukan');

  const teamList = await db
    .select()
    .from(teams)
    .where(eq(teams.tournamentId, tournamentId))
    .orderBy(asc(teams.seed), asc(teams.id));

  const allMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matches.round), asc(matches.matchIndex));

  const mIds = allMatches.map((m) => m.id);
  const allSets =
    mIds.length > 0
      ? await db
          .select()
          .from(matchSets)
          .where(inArray(matchSets.matchId, mIds))
          .orderBy(asc(matchSets.setNumber))
      : [];

  const setsByMatch = new Map<number, typeof allSets>();
  for (const s of allSets) {
    const arr = setsByMatch.get(s.matchId) ?? [];
    arr.push(s);
    setsByMatch.set(s.matchId, arr);
  }

  const enriched = allMatches.map((m) => ({
    ...m,
    sets: setsByMatch.get(m.id) ?? [],
  }));

  const standings = computePoolStandings(teamList, enriched, tournament.bestOf);
  const poolLetters = Object.keys(standings).sort();
  if (poolLetters.length === 0) {
    throw new Error('Belum ada pembagian Pool pada kategori ini');
  }

  const advancePerPool = tournament.advancePerPool ?? 2;
  const winners = poolLetters
    .map((p) => standings[p]?.[0])
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  const runnersUp =
    advancePerPool >= 2
      ? [...poolLetters]
          .reverse()
          .map((p) => standings[p]?.[1])
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
      : [];

  const seededQualifiers = [...winners, ...runnersUp].map((r) => r.team);
  if (seededQualifiers.length < 2) {
    throw new Error('Minimal 2 tim lolos diperlukan untuk mengisi Babak Gugur');
  }

  const r1MainMatches = allMatches
    .filter((m) => m.bracketType === 'main' && m.round === 1)
    .sort((a, b) => a.matchIndex - b.matchIndex);

  if (r1MainMatches.length === 0) {
    throw new Error('Bagan Babak Utama belum tersedia');
  }

  const koBracketSize = r1MainMatches.length * 2;
  const seedOrder = buildSeedOrder(koBracketSize);

  for (let idx = 0; idx < r1MainMatches.length; idx++) {
    const m = r1MainMatches[idx]!;
    const sA = seedOrder[idx * 2]!;
    const sB = seedOrder[idx * 2 + 1]!;
    const teamA = seededQualifiers[sA - 1] ?? null;
    const teamB = seededQualifiers[sB - 1] ?? null;

    await db
      .update(matches)
      .set({
        teamAId: teamA?.id ?? null,
        teamBId: teamB?.id ?? null,
        status: 'scheduled',
        winnerId: null,
      })
      .where(eq(matches.id, m.id));

    if (teamA && !teamB) {
      await db
        .update(matches)
        .set({ status: 'bye', winnerId: teamA.id })
        .where(eq(matches.id, m.id));
      await advanceWinner(m.id);
    } else if (!teamA && teamB) {
      await db
        .update(matches)
        .set({ status: 'bye', winnerId: teamB.id })
        .where(eq(matches.id, m.id));
      await advanceWinner(m.id);
    }
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

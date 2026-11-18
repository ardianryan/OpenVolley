import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, initDatabase } from '../db';
import { matches, teams, tournaments } from '../db/schema';
import { advanceWinner, buildSeedOrder, generateBracket, initializeDrawBracket } from './bracket';

describe('Bracket Engine', () => {
  let tournamentId: number;

  beforeAll(() => {
    initDatabase();
  });

  beforeEach(async () => {
    await db.delete(tournaments);
    const [t] = await db
      .insert(tournaments)
      .values({
        name: 'Test Putra',
        slug: `test-putra-${Date.now()}-${Math.random()}`,
        isEnabled: true,
        status: 'active',
        bestOf: 3,
        regularSetPoints: 25,
        decidingSetPoints: 15,
        useDeuce: true,
        hasThirdPlace: true,
        sortOrder: 1,
        createdAt: Date.now(),
      })
      .returning();
    tournamentId = t.id;
  });

  test('buildSeedOrder produces standard bracket seeding', () => {
    expect(buildSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(buildSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  test('generates bracket for 6 teams with 2 auto-byes and 3rd place match', async () => {
    const teamIds: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const [tm] = await db
        .insert(teams)
        .values({
          tournamentId,
          name: `Team ${i}`,
          shortCode: `TM${i}`,
          seed: i,
        })
        .returning();
      teamIds.push(tm.id);
    }

    const generated = await generateBracket(tournamentId);
    // 8-team bracket: 4 R1 + 2 SF + 1 Final + 1 Third Place = 8 matches
    expect(generated.length).toBe(8);

    const r1 = generated.filter((m) => m.round === 1);
    const byes = r1.filter((m) => m.status === 'bye');
    expect(byes.length).toBe(2);

    // Top 2 seeds should have auto-advanced to Semifinals
    const sf = generated.filter((m) => m.round === 2 && m.bracketType === 'main');
    expect(sf.length).toBe(2);
    const sfTeams = sf.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean);
    expect(sfTeams).toContain(teamIds[0]);
    expect(sfTeams).toContain(teamIds[1]);

    // 3rd place match exists
    const thirdPlace = generated.find((m) => m.bracketType === 'third_place');
    expect(thirdPlace).toBeDefined();
  });

  test('advanceWinner moves winner to Final and loser to 3rd Place', async () => {
    const teamIds: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const [tm] = await db
        .insert(teams)
        .values({
          tournamentId,
          name: `Club ${i}`,
          shortCode: `CL${i}`,
          seed: i,
        })
        .returning();
      teamIds.push(tm.id);
    }

    const generated = await generateBracket(tournamentId);
    const sf1 = generated.find((m) => m.round === 1 && m.matchIndex === 0)!;
    const sf2 = generated.find((m) => m.round === 1 && m.matchIndex === 1)!;

    // Simulate SF1 winner = teamA, SF2 winner = teamB
    await db
      .update(matches)
      .set({ status: 'finished', winnerId: sf1.teamAId })
      .where(eq(matches.id, sf1.id));
    await advanceWinner(sf1.id);

    await db
      .update(matches)
      .set({ status: 'finished', winnerId: sf2.teamBId })
      .where(eq(matches.id, sf2.id));
    await advanceWinner(sf2.id);

    const allAfter = await db
      .select()
      .from(matches)
      .where(eq(matches.tournamentId, tournamentId));

    const finalMatch = allAfter.find((m) => m.bracketType === 'main' && m.round === 2)!;
    const thirdMatch = allAfter.find((m) => m.bracketType === 'third_place')!;

    expect(finalMatch.teamAId).toBe(sf1.teamAId);
    expect(finalMatch.teamBId).toBe(sf2.teamBId);
    expect(thirdMatch.teamAId).toBe(sf1.teamBId);
    expect(thirdMatch.teamBId).toBe(sf2.teamAId);
  });

  test('initializeDrawBracket creates 16 Undian slots and 16 symmetric matches (8 R1 + 4 QF + 2 SF + Final + 3rd)', async () => {
    const generated = await initializeDrawBracket(tournamentId, 16);
    expect(generated.length).toBe(16);

    const r1 = generated.filter((m) => m.round === 1);
    const r2 = generated.filter((m) => m.round === 2);
    const r3 = generated.filter((m) => m.round === 3);
    const r4Main = generated.filter((m) => m.round === 4 && m.bracketType === 'main');
    const third = generated.filter((m) => m.bracketType === 'third_place');

    expect(r1.length).toBe(8);
    expect(r2.length).toBe(4);
    expect(r3.length).toBe(2);
    expect(r4Main.length).toBe(1);
    expect(third.length).toBe(1);
  });
});

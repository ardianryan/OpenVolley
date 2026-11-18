export interface PoolTeamLite {
  id: number;
  name: string;
  shortCode: string;
  school?: string;
  logoUrl?: string | null;
  color?: string;
  seed: number;
  poolName?: string | null;
}

export interface PoolSetLite {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  isFinished: boolean;
}

export interface PoolMatchLite {
  id: number;
  bracketType: 'main' | 'third_place' | 'pool';
  poolName?: string | null;
  teamAId: number | null;
  teamBId: number | null;
  winnerId: number | null;
  status: 'scheduled' | 'live' | 'finished' | 'bye';
  setsWonA: number;
  setsWonB: number;
  bestOf?: number | null;
  sets: PoolSetLite[];
}

export interface PoolStandingRow {
  rank: number;
  poolName: string;
  team: PoolTeamLite;
  played: number;
  won: number;
  lost: number;
  matchPoints: number;
  setsWon: number;
  setsLost: number;
  setRatio: number;
  pointsWon: number;
  pointsLost: number;
  pointRatio: number;
}

/**
 * Computes FIVB/PBVSI match classification points awarded to winner & loser:
 * - Decisive victory (3-0 / 3-1 in Bo5, 2-0 in Bo3, 1-0 in Bo1): Winner 3 pts, Loser 0 pts.
 * - Tight deciding-set victory (3-2 in Bo5, 2-1 in Bo3): Winner 2 pts, Loser 1 pt.
 */
export function computeFivbMatchPoints(
  setsA: number,
  setsB: number,
  bestOf = 3
): { pointsA: number; pointsB: number } {
  if (setsA === setsB) return { pointsA: 0, pointsB: 0 };
  const aWon = setsA > setsB;
  const winSets = aWon ? setsA : setsB;
  const loseSets = aWon ? setsB : setsA;

  let winPts = 3;
  let losePts = 0;

  if (bestOf >= 5) {
    if (winSets === 3 && loseSets === 2) {
      winPts = 2;
      losePts = 1;
    }
  } else if (bestOf === 3) {
    if (winSets === 2 && loseSets === 1) {
      winPts = 2;
      losePts = 1;
    }
  }

  return aWon ? { pointsA: winPts, pointsB: losePts } : { pointsA: losePts, pointsB: winPts };
}

/**
 * Generates balanced round-robin pairings using the standard circle method.
 */
export function generateRoundRobinPairs<T>(items: T[]): Array<{ round: number; a: T; b: T }> {
  if (items.length < 2) return [];
  const list: Array<T | null> = [...items];
  if (list.length % 2 === 1) {
    list.push(null); // Odd-count bye dummy
  }

  const n = list.length;
  const rounds = n - 1;
  const half = n / 2;
  const pairs: Array<{ round: number; a: T; b: T }> = [];

  const rot = [...list];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const left = rot[i] ?? null;
      const right = rot[n - 1 - i] ?? null;
      if (left !== null && right !== null) {
        pairs.push({
          round: r + 1,
          a: r % 2 === 0 && i === 0 ? left : right,
          b: r % 2 === 0 && i === 0 ? right : left,
        });
      }
    }
    // Rotate all except index 0
    const last = rot.pop()!;
    rot.splice(1, 0, last);
  }

  return pairs;
}

/**
 * Computes official FIVB pool standings grouped by pool letter ('A', 'B', ...).
 * Tie-breaker order:
 * 1. Matches Won (won DESC)
 * 2. Match Points (matchPoints DESC)
 * 3. Set Ratio (setsWon / setsLost DESC; infinity capped cleanly at setsWon * 1000 when setsLost = 0)
 * 4. Point Ratio (pointsWon / pointsLost DESC)
 * 5. Initial Seed (seed ASC)
 */
export function computePoolStandings(
  teamList: PoolTeamLite[],
  matchList: PoolMatchLite[],
  defaultBestOf = 3
): Record<string, PoolStandingRow[]> {
  const byPool = new Map<string, Map<number, PoolStandingRow>>();

  for (const t of teamList) {
    const pName = (t.poolName || '').trim().toUpperCase();
    if (!pName) continue;
    let poolMap = byPool.get(pName);
    if (!poolMap) {
      poolMap = new Map();
      byPool.set(pName, poolMap);
    }
    poolMap.set(t.id, {
      rank: 0,
      poolName: pName,
      team: t,
      played: 0,
      won: 0,
      lost: 0,
      matchPoints: 0,
      setsWon: 0,
      setsLost: 0,
      setRatio: 0,
      pointsWon: 0,
      pointsLost: 0,
      pointRatio: 0,
    });
  }

  for (const m of matchList) {
    if (m.bracketType !== 'pool' || m.status !== 'finished') continue;
    if (!m.teamAId || !m.teamBId) continue;

    const pName = (m.poolName || '').trim().toUpperCase();
    const poolMap = pName ? byPool.get(pName) : undefined;
    if (!poolMap) continue;

    const rowA = poolMap.get(m.teamAId);
    const rowB = poolMap.get(m.teamBId);
    if (!rowA || !rowB) continue;

    rowA.played += 1;
    rowB.played += 1;

    const aWon = m.winnerId === m.teamAId || (!m.winnerId && m.setsWonA > m.setsWonB);
    if (aWon) {
      rowA.won += 1;
      rowB.lost += 1;
    } else {
      rowB.won += 1;
      rowA.lost += 1;
    }

    rowA.setsWon += m.setsWonA;
    rowA.setsLost += m.setsWonB;
    rowB.setsWon += m.setsWonB;
    rowB.setsLost += m.setsWonA;

    const { pointsA, pointsB } = computeFivbMatchPoints(
      m.setsWonA,
      m.setsWonB,
      m.bestOf ?? defaultBestOf
    );
    rowA.matchPoints += pointsA;
    rowB.matchPoints += pointsB;

    for (const s of m.sets) {
      rowA.pointsWon += s.scoreA;
      rowA.pointsLost += s.scoreB;
      rowB.pointsWon += s.scoreB;
      rowB.pointsLost += s.scoreA;
    }
  }

  const out: Record<string, PoolStandingRow[]> = {};
  const sortedPools = [...byPool.keys()].sort();

  for (const pName of sortedPools) {
    const rows = [...byPool.get(pName)!.values()];
    for (const r of rows) {
      r.setRatio =
        r.setsLost === 0
          ? r.setsWon > 0
            ? r.setsWon * 1000
            : 0
          : Number((r.setsWon / r.setsLost).toFixed(3));
      r.pointRatio =
        r.pointsLost === 0
          ? r.pointsWon > 0
            ? r.pointsWon * 1000
            : 0
          : Number((r.pointsWon / r.pointsLost).toFixed(3));
    }

    rows.sort((a, b) => {
      if (b.won !== a.won) return b.won - a.won;
      if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
      if (b.setRatio !== a.setRatio) return b.setRatio - a.setRatio;
      if (b.pointRatio !== a.pointRatio) return b.pointRatio - a.pointRatio;
      return a.team.seed - b.team.seed;
    });

    rows.forEach((r, idx) => {
      r.rank = idx + 1;
    });
    out[pName] = rows;
  }

  return out;
}

export type MasterTeamLevel = 'smp' | 'sma' | 'kab_kota' | 'umum';

export const MASTER_TEAM_LEVEL_LABELS: Record<MasterTeamLevel, string> = {
  smp: 'SMP / MTs',
  sma: 'SMA / SMK / MA',
  kab_kota: 'Kontingen Kab / Kota',
  umum: 'Klub / Umum',
};

export function sanitizeMasterLevel(raw?: string | null): MasterTeamLevel {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'smp' || v === 'mts' || v.includes('smp') || v.includes('mts')) {
    return 'smp';
  }
  if (
    v === 'sma' ||
    v === 'smk' ||
    v === 'ma' ||
    v.includes('sma') ||
    v.includes('smk')
  ) {
    return 'sma';
  }
  if (
    v === 'kab_kota' ||
    v === 'kab/kota' ||
    v === 'daerah' ||
    v === 'provinsi' ||
    v.includes('kab') ||
    v.includes('kota')
  ) {
    return 'kab_kota';
  }
  return 'umum';
}

export function inferTeamLevelFromName(
  name: string,
  school?: string | null
): MasterTeamLevel {
  const n = (name || '').trim().toUpperCase();
  if (/^(SMP|SMPN|SMPS|MTS|MTSN|MTSS|SLTP)\b/.test(n)) return 'smp';
  if (/^(SMA|SMAN|SMAS|SMK|SMKN|SMKS|MA|MAN|MAS|SLTA)\b/.test(n)) return 'sma';
  if (/^(KAB\.|KAB\b|KABUPATEN\b|KOTA\b|KONTINGEN\b|PENGKAB\b|PENGKOT\b)/.test(n)) {
    return 'kab_kota';
  }
  const s = (school || '').trim().toUpperCase();
  if (/^(SMP|MTS)\b/.test(s)) return 'smp';
  if (/^(SMA|SMK|MA)\b/.test(s)) return 'sma';
  return 'umum';
}

export function isPlaceholderDrawSlotName(name?: string | null): boolean {
  const clean = (name || '').trim();
  if (!clean) return true;
  return /^\[\s*(Undian|Slot)\s*\d+\s*\]$/i.test(clean);
}

/**
 * Standard FIVB / Olympic symmetric bracket seed order:
 * Seed 1 & Seed 2 sit on opposite halves (only meet in Grand Final);
 * Seed 3 & Seed 4 sit in opposite quarters; BYEs automatically go to top seeds.
 * Example n=8 -> [1, 8, 4, 5, 2, 7, 3, 6]
 */
export function buildFivbSeedOrder(bracketSize: number): number[] {
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

export interface DrawCandidate {
  id: number;
  school?: string | null;
  isSeeded?: boolean;
  seed?: number;
}

function normalizeRegionKey(school?: string | null): string {
  return (school || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function shuffleWithRng<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Computes optimal 1..N seed assignment for a Knockout bracket:
 * - Seeded teams (`isSeeded === true`) occupy top seeds 1..K (preserving relative seed order)
 *   so they automatically split across Left/Right wings & receive BYEs first.
 * - Unseeded teams are shuffled into seeds K+1..N, and when `separateSameRegion` is enabled,
 *   swaps unseeded slots to minimize Round-1 and same-quarter clashes between teams from the same Kota/Kabupaten.
 */
export function computeFivbKnockoutSeedAssignment<T extends DrawCandidate>(
  entries: T[],
  options?: {
    separateSameRegion?: boolean;
    randomFn?: () => number;
  }
): Array<{ entry: T; assignedSeed: number }> {
  if (entries.length === 0) return [];
  const rng = options?.randomFn ?? Math.random;
  const separateRegion = options?.separateSameRegion ?? true;

  const seeded = entries
    .filter((e) => Boolean(e.isSeeded))
    .sort((a, b) => (a.seed || 999) - (b.seed || 999) || a.id - b.id);
  const unseeded = shuffleWithRng(
    entries.filter((e) => !e.isSeeded),
    rng
  );

  // Ordered array indexed 0..N-1 representing Seed 1..N
  const bySeed: T[] = [...seeded, ...unseeded];
  const lockedCount = seeded.length;
  const n = bySeed.length;

  if (!separateRegion || n - lockedCount <= 1) {
    return bySeed.map((entry, idx) => ({ entry, assignedSeed: idx + 1 }));
  }

  const totalRounds = Math.max(1, Math.ceil(Math.log2(n)));
  const bracketSize = Math.pow(2, totalRounds);
  const seedOrder = buildFivbSeedOrder(bracketSize); // length = bracketSize

  // Evaluate conflict cost of a candidate `bySeed` array:
  // - Direct Round-1 clash of same non-empty region: +100 penalty
  // - Same quarter (pair of adjacent R1 matches) of same non-empty region: +18 penalty
  // - Imbalance of same region on Left Wing vs Right Wing: +4 * |leftCount - rightCount|
  const scoreArrangement = (arr: T[]): number => {
    let penalty = 0;
    const matchCountR1 = bracketSize / 2;
    const matchRegions: Array<[string, string]> = [];

    for (let m = 0; m < matchCountR1; m++) {
      const sA = seedOrder[m * 2]!;
      const sB = seedOrder[m * 2 + 1]!;
      const tA = sA <= arr.length ? arr[sA - 1] : undefined;
      const tB = sB <= arr.length ? arr[sB - 1] : undefined;
      const rA = normalizeRegionKey(tA?.school);
      const rB = normalizeRegionKey(tB?.school);
      if (rA && rB && rA === rB) {
        penalty += 100;
      }
      matchRegions.push([rA, rB]);
    }

    // Quarter clash check (adjacent R1 pairs)
    for (let q = 0; q + 1 < matchRegions.length; q += 2) {
      const regs1 = matchRegions[q]!.filter(Boolean);
      const regs2 = matchRegions[q + 1]!.filter(Boolean);
      for (const r1 of regs1) {
        for (const r2 of regs2) {
          if (r1 === r2) penalty += 18;
        }
      }
    }

    // Wing balance check
    if (matchCountR1 >= 2) {
      const halfM = matchCountR1 / 2;
      const leftCounts = new Map<string, number>();
      const rightCounts = new Map<string, number>();
      const allRegs = new Set<string>();

      for (let m = 0; m < matchCountR1; m++) {
        const target = m < halfM ? leftCounts : rightCounts;
        for (const r of matchRegions[m]!) {
          if (!r) continue;
          allRegs.add(r);
          target.set(r, (target.get(r) ?? 0) + 1);
        }
      }
      for (const r of allRegs) {
        const diff = Math.abs((leftCounts.get(r) ?? 0) - (rightCounts.get(r) ?? 0));
        if (diff > 1) penalty += (diff - 1) * 6;
      }
    }

    return penalty;
  };

  let currentPenalty = scoreArrangement(bySeed);
  const maxPasses = Math.min(240, (n - lockedCount) * 30);

  for (let step = 0; step < maxPasses && currentPenalty > 0; step++) {
    const i = lockedCount + Math.floor(rng() * (n - lockedCount));
    const j = lockedCount + Math.floor(rng() * (n - lockedCount));
    if (i === j) continue;

    const tmp = bySeed[i]!;
    bySeed[i] = bySeed[j]!;
    bySeed[j] = tmp;

    const nextPenalty = scoreArrangement(bySeed);
    if (nextPenalty <= currentPenalty) {
      currentPenalty = nextPenalty;
    } else {
      // Revert swap
      bySeed[j] = bySeed[i]!;
      bySeed[i] = tmp;
    }
  }

  return bySeed.map((entry, idx) => ({ entry, assignedSeed: idx + 1 }));
}

/**
 * Computes FIVB Serpentine (Snake) Pool distribution (A -> B -> C -> D -> D -> C -> B -> A)
 * while separating teams from the same Kota/Kabupaten across different pools whenever possible.
 */
export function computeFivbPoolSnakeAssignment<T extends DrawCandidate>(
  entries: T[],
  poolCount: number,
  options?: {
    separateSameRegion?: boolean;
    randomFn?: () => number;
  }
): Array<{ entry: T; poolName: string; assignedSeed: number }> {
  if (entries.length === 0) return [];
  const safePoolCount = Math.max(2, Math.min(8, poolCount));
  const poolLetters = Array.from({ length: safePoolCount }, (_, i) =>
    String.fromCharCode(65 + i)
  );
  const rng = options?.randomFn ?? Math.random;
  const separateRegion = options?.separateSameRegion ?? true;

  const seeded = entries
    .filter((e) => Boolean(e.isSeeded))
    .sort((a, b) => (a.seed || 999) - (b.seed || 999) || a.id - b.id);
  const unseeded = shuffleWithRng(
    entries.filter((e) => !e.isSeeded),
    rng
  );
  const ordered = [...seeded, ...unseeded];

  const poolBuckets = new Map<string, T[]>();
  for (const p of poolLetters) poolBuckets.set(p, []);

  // Process tier-by-tier (each tier has up to `safePoolCount` teams) in FIVB serpentine direction
  for (let start = 0, tier = 0; start < ordered.length; start += safePoolCount, tier++) {
    const slice = ordered.slice(start, start + safePoolCount);
    const tierPools = tier % 2 === 0 ? [...poolLetters] : [...poolLetters].reverse();

    if (!separateRegion) {
      slice.forEach((entry, idx) => {
        const pKey = tierPools[idx]!;
        poolBuckets.get(pKey)!.push(entry);
      });
      continue;
    }

    const availablePools = [...tierPools];
    for (const entry of slice) {
      if (entry.isSeeded) {
        // Seeded teams strictly follow FIVB serpentine pot position
        const pKey = availablePools.shift()!;
        poolBuckets.get(pKey)!.push(entry);
        continue;
      }

      const reg = normalizeRegionKey(entry.school);
      let bestIdx = 0;
      let bestCost = Number.POSITIVE_INFINITY;

      availablePools.forEach((pKey, idx) => {
        const bucket = poolBuckets.get(pKey)!;
        const sameRegCount = reg
          ? bucket.filter((b) => normalizeRegionKey(b.school) === reg).length
          : 0;
        const cost = sameRegCount * 50 + bucket.length * 5 + idx * 0.01;
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = idx;
        }
      });

      const chosenPool = availablePools.splice(bestIdx, 1)[0]!;
      poolBuckets.get(chosenPool)!.push(entry);
    }
  }

  const results: Array<{ entry: T; poolName: string; assignedSeed: number }> = [];
  let runningSeed = 1;
  for (const pKey of poolLetters) {
    for (const entry of poolBuckets.get(pKey)!) {
      results.push({
        entry,
        poolName: pKey,
        assignedSeed: runningSeed++,
      });
    }
  }
  return results;
}

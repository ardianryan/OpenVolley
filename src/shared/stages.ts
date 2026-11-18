export type StagePresetKey =
  | 'pool'
  | 'r16'
  | 'qf'
  | 'sf'
  | 'third'
  | 'final';

export interface MatchStageInput {
  round: number;
  bracketType: 'main' | 'third_place' | 'pool';
  poolName?: string | null;
}

/**
 * Resolves the canonical international volleyball broadcast stage key from a match and total main rounds.
 */
export function detectMatchStageKey(
  match: MatchStageInput | null | undefined,
  totalMainRounds: number
): StagePresetKey {
  if (!match) return 'r16';
  if (match.bracketType === 'pool') return 'pool';
  if (match.bracketType === 'third_place') return 'third';

  const safeTotal = Math.max(1, totalMainRounds);
  const diff = safeTotal - match.round;
  if (diff <= 0) return 'final';
  if (diff === 1) return 'sf';
  if (diff === 2) return 'qf';
  return 'r16';
}

/**
 * Formats an unambiguous international volleyball stage label (FIVB / VNL standard).
 * Eliminates local ambiguity between "Pool Stage" and knockout bracket wings.
 */
export function formatInternationalStageLabel(
  match: MatchStageInput | null | undefined,
  totalMainRounds: number,
  options?: { uppercase?: boolean; wing?: 'L' | 'R' }
): string {
  if (!match) {
    return options?.uppercase ? 'MATCHDAY' : 'Matchday';
  }

  let label: string;
  if (match.bracketType === 'pool') {
    label = match.poolName ? `Pool ${match.poolName.toUpperCase()}` : 'Pool Stage';
  } else if (match.bracketType === 'third_place') {
    label = '3rd Place Match';
  } else {
    const safeTotal = Math.max(1, totalMainRounds);
    const diff = safeTotal - match.round;
    if (diff <= 0) {
      label = 'Grand Final';
    } else if (diff === 1) {
      label = options?.wing ? `Semi-Final (${options.wing})` : 'Semi-Final';
    } else if (diff === 2) {
      label = 'Quarter-Final';
    } else if (diff === 3) {
      label = 'Round of 16';
    } else {
      const teamsInRound = Math.pow(2, diff + 1);
      label = `Round of ${teamsInRound}`;
    }
  }

  return options?.uppercase ? label.toUpperCase() : label;
}

export function formatRoundColumnLabel(
  round: number,
  totalRounds: number,
  wing?: 'L' | 'R'
): string {
  return formatInternationalStageLabel(
    { round, bracketType: 'main' },
    totalRounds,
    { wing }
  );
}

export interface StageVisualMeta {
  key: StagePresetKey;
  badge: string;
  subheadline: string;
  accentHex: string;
  secondaryHex: string;
  isHighStakes: boolean;
}

export const STAGE_VISUAL_META: Record<StagePresetKey, StageVisualMeta> = {
  pool: {
    key: 'pool',
    badge: 'POOL STAGE',
    subheadline: 'GROUP ROUND-ROBIN',
    accentHex: '#38BDF8',
    secondaryHex: '#0284C7',
    isHighStakes: false,
  },
  r16: {
    key: 'r16',
    badge: 'ROUND OF 16',
    subheadline: 'MAIN BRACKET KNOCKOUT',
    accentHex: '#F5C538',
    secondaryHex: '#D97706',
    isHighStakes: false,
  },
  qf: {
    key: 'qf',
    badge: 'QUARTER-FINAL',
    subheadline: 'LAST 8 KNOCKOUT STAGE',
    accentHex: '#22D3EE',
    secondaryHex: '#F5C538',
    isHighStakes: true,
  },
  sf: {
    key: 'sf',
    badge: 'SEMI-FINAL',
    subheadline: 'ROAD TO GRAND FINAL',
    accentHex: '#FB7185',
    secondaryHex: '#F5C538',
    isHighStakes: true,
  },
  third: {
    key: 'third',
    badge: '3RD PLACE MATCH',
    subheadline: 'BRONZE MEDAL MATCH',
    accentHex: '#FB923C',
    secondaryHex: '#EA580C',
    isHighStakes: true,
  },
  final: {
    key: 'final',
    badge: 'GRAND FINAL',
    subheadline: 'CHAMPIONSHIP MATCH',
    accentHex: '#FACC15',
    secondaryHex: '#F59E0B',
    isHighStakes: true,
  },
};

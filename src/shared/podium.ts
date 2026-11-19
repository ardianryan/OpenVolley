import type { Match, Team, Tournament } from '../client/types';

export interface PodiumResolution {
  hasThirdPlace: boolean;
  champion: Team | null;
  runnerUp: Team | null;
  thirdPlace: Team | null;
  fourthPlace: Team | null;
  jointThirdTeams: Team[];
  isJointThird: boolean;
  status: 'provisional' | 'final';
}

/**
 * Resolves official tournament podium winners (1st, 2nd, 3rd, and 4th/Joint-3rd).
 * According to national & international volleyball standards (PBVSI / FIVB):
 * - If `hasThirdPlace` is false (or skipped), both semifinal losers are officially
 *   recognized as Joint 3rd Place winners (Juara 3 Bersama), with NO 4th place award.
 * - If `hasThirdPlace` is true, a dedicated 3rd-place playoff match determines 3rd and 4th place.
 */
export function resolveTournamentPodium(
  tournament: Pick<Tournament, 'id' | 'hasThirdPlace'>,
  matches: Match[],
  teams: Team[]
): PodiumResolution {
  const teamMap = new Map<number, Team>(teams.map((t) => [t.id, t]));
  const catMatches = matches.filter((m) => m.tournamentId === tournament.id);
  const mainMatches = catMatches.filter((m) => m.bracketType === 'main');
  const thirdPlaceMatch = catMatches.find((m) => m.bracketType === 'third_place');

  const hasThirdPlace = tournament.hasThirdPlace ?? Boolean(thirdPlaceMatch);

  if (mainMatches.length === 0) {
    return {
      hasThirdPlace,
      champion: null,
      runnerUp: null,
      thirdPlace: null,
      fourthPlace: null,
      jointThirdTeams: [],
      isJointThird: !hasThirdPlace,
      status: 'provisional',
    };
  }

  const maxRound = Math.max(...mainMatches.map((m) => m.round));
  const finalMatch = mainMatches.find((m) => m.round === maxRound);

  const champion = finalMatch?.winnerId ? teamMap.get(finalMatch.winnerId) ?? null : null;
  const runnerUp =
    finalMatch?.winnerId && finalMatch.teamAId && finalMatch.teamBId
      ? teamMap.get(
          finalMatch.winnerId === finalMatch.teamAId
            ? finalMatch.teamBId
            : finalMatch.teamAId
        ) ?? null
      : null;

  if (hasThirdPlace) {
    const thirdWinner = thirdPlaceMatch?.winnerId
      ? teamMap.get(thirdPlaceMatch.winnerId) ?? null
      : null;
    const fourth =
      thirdPlaceMatch?.winnerId && thirdPlaceMatch.teamAId && thirdPlaceMatch.teamBId
        ? teamMap.get(
            thirdPlaceMatch.winnerId === thirdPlaceMatch.teamAId
              ? thirdPlaceMatch.teamBId
              : thirdPlaceMatch.teamAId
          ) ?? null
        : null;

    const isFinal = Boolean(champion && runnerUp && thirdWinner);

    return {
      hasThirdPlace: true,
      champion,
      runnerUp,
      thirdPlace: thirdWinner,
      fourthPlace: fourth,
      jointThirdTeams: thirdWinner ? [thirdWinner] : [],
      isJointThird: false,
      status: isFinal ? 'final' : 'provisional',
    };
  }

  // When 3rd place match is skipped -> Both semifinal losers become "Juara 3 Bersama"
  const semiRound = maxRound - 1;
  const semiMatches = semiRound >= 1 ? mainMatches.filter((m) => m.round === semiRound) : [];
  const jointThirdTeams: Team[] = [];

  for (const sm of semiMatches) {
    if (sm.winnerId && sm.teamAId && sm.teamBId) {
      const loserId = sm.winnerId === sm.teamAId ? sm.teamBId : sm.teamAId;
      const loserTeam = teamMap.get(loserId);
      if (loserTeam && !jointThirdTeams.some((t) => t.id === loserTeam.id)) {
        jointThirdTeams.push(loserTeam);
      }
    }
  }

  const isFinal = Boolean(champion && runnerUp && jointThirdTeams.length >= 2);

  return {
    hasThirdPlace: false,
    champion,
    runnerUp,
    thirdPlace: jointThirdTeams[0] ?? null,
    fourthPlace: null,
    jointThirdTeams,
    isJointThird: true,
    status: isFinal ? 'final' : 'provisional',
  };
}

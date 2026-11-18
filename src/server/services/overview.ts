import { asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  matchReports,
  matchSets,
  matches,
  siteSettings,
  teams,
  tournaments,
} from '../db/schema';
import { getOverviewVersion, onCacheInvalidate } from './sse';

let cachedPublicOverview: Awaited<ReturnType<typeof queryFullOverview>> | null = null;
let cachedVersion = -1;

onCacheInvalidate(() => {
  cachedPublicOverview = null;
});

export async function getFullOverview(includeDisabledTournaments = false) {
  if (!includeDisabledTournaments) {
    const currentVer = getOverviewVersion();
    if (cachedPublicOverview && cachedVersion === currentVer) {
      return cachedPublicOverview;
    }
    const fresh = await queryFullOverview(false);
    cachedPublicOverview = fresh;
    cachedVersion = currentVer;
    return fresh;
  }
  return queryFullOverview(true);
}

async function queryFullOverview(includeDisabledTournaments = false) {
  const rawSettings = await db.query.siteSettings.findFirst();
  const settings =
    rawSettings && !includeDisabledTournaments
      ? (() => {
          const { tvPin: _hidden, ...publicSafe } = rawSettings;
          return publicSafe;
        })()
      : rawSettings;

  const tournamentList = includeDisabledTournaments
    ? await db.select().from(tournaments).orderBy(asc(tournaments.sortOrder), asc(tournaments.id))
    : await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.isEnabled, true))
        .orderBy(asc(tournaments.sortOrder), asc(tournaments.id));

  const tournamentIds = tournamentList.map((t) => t.id);

  if (tournamentIds.length === 0) {
    return {
      settings,
      tournaments: [],
      teams: [],
      matches: [],
      reports: [],
    };
  }

  const teamList = await db
    .select()
    .from(teams)
    .where(inArray(teams.tournamentId, tournamentIds))
    .orderBy(asc(teams.seed), asc(teams.id));

  const matchList = await db
    .select()
    .from(matches)
    .where(inArray(matches.tournamentId, tournamentIds))
    .orderBy(asc(matches.round), asc(matches.matchIndex));

  const matchIds = matchList.map((m) => m.id);
  const allSets =
    matchIds.length > 0
      ? await db
          .select()
          .from(matchSets)
          .where(inArray(matchSets.matchId, matchIds))
          .orderBy(asc(matchSets.setNumber))
      : [];

  const setsByMatch = new Map<number, typeof allSets>();
  for (const s of allSets) {
    const arr = setsByMatch.get(s.matchId) ?? [];
    arr.push(s);
    setsByMatch.set(s.matchId, arr);
  }

  const enrichedMatches = matchList.map((m) => ({
    ...m,
    sets: setsByMatch.get(m.id) ?? [],
  }));

  const reports =
    matchIds.length > 0
      ? await db
          .select()
          .from(matchReports)
          .where(inArray(matchReports.matchId, matchIds))
          .orderBy(desc(matchReports.createdAt))
          .limit(40)
      : [];

  return {
    settings,
    tournaments: tournamentList,
    teams: teamList,
    matches: enrichedMatches,
    reports,
  };
}

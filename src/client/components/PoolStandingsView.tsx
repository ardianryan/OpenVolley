import { Award, CheckCircle2, Layers, Radio } from 'lucide-react';
import { computePoolStandings } from '../../shared/pool';
import type { Match, Team, Tournament } from '../types';
import { TeamAvatar } from './TeamAvatar';

interface PoolStandingsViewProps {
  tournament: Tournament;
  teams: Team[];
  matches: Match[];
  onSelectMatch?: (match: Match) => void;
}

export function PoolStandingsView({
  tournament,
  teams,
  matches,
  onSelectMatch,
}: PoolStandingsViewProps) {
  const poolMatches = matches.filter((m) => m.bracketType === 'pool');
  const standingsByPool = computePoolStandings(teams, matches, tournament.bestOf);
  const poolKeys = Object.keys(standingsByPool).sort();

  if (poolKeys.length === 0) {
    return null;
  }

  const advanceLimit = tournament.advancePerPool ?? 2;
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-2.5 text-xs dark:bg-amber-500/10">
        <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
          <Layers className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          <span>Pool Standings • FIVB Scoring System (3-2-1-0)</span>
        </div>
        <span className="font-semibold text-amber-800 dark:text-amber-300">
          Top {advanceLimit} per Pool qualify for Main Knockout Bracket
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {poolKeys.map((poolKey) => {
          const rows = standingsByPool[poolKey] ?? [];
          const fixtures = poolMatches.filter(
            (m) => (m.poolName || '').toUpperCase() === poolKey
          );

          return (
            <div
              key={poolKey}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/95"
            >
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-900 px-4 py-2.5 text-white dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="sport-skew inline-block rounded bg-amber-500 px-2.5 py-0.5 text-xs font-extrabold uppercase text-slate-950">
                    <span className="sport-unskew">POOL {poolKey}</span>
                  </span>
                  <span className="text-xs font-semibold text-slate-300">
                    {rows.length} Teams
                  </span>
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                  {fixtures.filter((f) => f.status === 'finished').length}/{fixtures.length}{' '}
                  Completed
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase text-slate-600 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-center">#</th>
                      <th className="px-2.5 py-2">Team</th>
                      <th className="px-2 py-2 text-center" title="Matches Played">
                        P
                      </th>
                      <th className="px-2 py-2 text-center" title="Won - Lost">
                        W-L
                      </th>
                      <th
                        className="bg-amber-500/12 px-2.5 py-2 text-center text-amber-800 dark:text-amber-300"
                        title="FIVB Match Points"
                      >
                        PTS
                      </th>
                      <th className="px-2 py-2 text-center" title="Sets Won - Sets Lost">
                        SETS
                      </th>
                      <th className="px-2.5 py-2 text-center" title="Rally Points Won - Lost">
                        POINTS
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {rows.map((r, idx) => {
                      const qualifies = idx < advanceLimit;
                      return (
                        <tr
                          key={r.team.id}
                          className={
                            qualifies
                              ? 'bg-emerald-500/6 dark:bg-emerald-500/8'
                              : ''
                          }
                        >
                          <td className="px-3 py-2.5 text-center font-bold">
                            <span
                              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                                qualifies
                                  ? 'bg-emerald-500/20 font-extrabold text-emerald-800 dark:text-emerald-300'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <div className="flex items-center gap-2">
                              <TeamAvatar team={r.team} size="sm" />
                              <div className="min-w-0">
                                <p className="truncate font-bold text-slate-900 dark:text-white">
                                  {r.team.name}
                                </p>
                                {qualifies && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                                    <Award className="h-2.5 w-2.5" />
                                    Qualified
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-center font-medium text-slate-700 dark:text-slate-300">
                            {r.played}
                          </td>
                          <td className="px-2 py-2.5 text-center font-semibold text-slate-800 dark:text-slate-200">
                            {r.won}-{r.lost}
                          </td>
                          <td className="bg-amber-500/10 px-2.5 py-2.5 text-center font-display text-sm font-extrabold text-amber-800 dark:text-amber-300">
                            {r.matchPoints}
                          </td>
                          <td className="px-2 py-2.5 text-center text-slate-600 dark:text-slate-400">
                            {r.setsWon}-{r.setsLost}
                          </td>
                          <td className="px-2.5 py-2.5 text-center text-slate-600 dark:text-slate-400">
                            {r.pointsWon}-{r.pointsLost}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {fixtures.length > 0 && (
                <div className="border-t border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Pool {poolKey} Fixtures &amp; Results
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {fixtures.map((fx) => {
                      const tA = fx.teamAId ? teamMap.get(fx.teamAId) : null;
                      const tB = fx.teamBId ? teamMap.get(fx.teamBId) : null;
                      const isLive = fx.status === 'live';
                      const isDone = fx.status === 'finished';
                      return (
                        <button
                          key={fx.id}
                          type="button"
                          onClick={() => onSelectMatch?.(fx)}
                          className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left text-xs transition ${
                            isLive
                              ? 'border-red-500/50 bg-red-500/10'
                              : 'border-slate-200 bg-white hover:border-amber-500/50 dark:border-slate-800 dark:bg-slate-900'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-slate-800 dark:text-slate-200">
                              {tA?.shortCode || tA?.name || 'TBD'}{' '}
                              <span className="text-slate-400">vs</span>{' '}
                              {tB?.shortCode || tB?.name || 'TBD'}
                            </p>
                            <p className="truncate text-[10px] text-slate-500">
                              {fx.courtName}
                              {fx.scheduledAt ? ` • ${fx.scheduledAt}` : ''}
                            </p>
                          </div>
                          {isLive ? (
                            <span className="inline-flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                              <Radio className="h-2.5 w-2.5" />
                              {fx.setsWonA}-{fx.setsWonB}
                            </span>
                          ) : isDone ? (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 font-display text-xs font-extrabold text-amber-800 dark:text-amber-300">
                              <CheckCircle2 className="h-3 w-3" />
                              {fx.setsWonA}-{fx.setsWonB}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase text-slate-400">
                              Upcoming
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

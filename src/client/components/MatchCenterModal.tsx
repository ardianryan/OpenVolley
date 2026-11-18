import {
  Camera,
  Download,
  GitBranch,
  Trophy,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatInternationalStageLabel } from '../../shared/stages';
import type {
  Match,
  MatchReport,
  SiteSettings,
  Team,
  Tournament,
} from '../types';
import { GalleryMediaCard } from './GalleryMediaCard';
import { TeamAvatar } from './TeamAvatar';
import { VolleyballIcon } from './VolleyballIcon';

interface MatchCenterModalProps {
  match: Match;
  teamA?: Team | null;
  teamB?: Team | null;
  categoryName?: string;
  tournament?: Tournament | null;
  settings?: SiteSettings | null;
  totalMainRounds?: number;
  reports: MatchReport[];
  onClose: () => void;
  onJumpToBracket?: (matchId: number) => void;
}

export function MatchCenterModal({
  match,
  teamA,
  teamB,
  categoryName,
  tournament,
  settings,
  totalMainRounds,
  reports,
  onClose,
  onJumpToBracket,
}: MatchCenterModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const requestClose = useCallback(() => {
    setIsClosing((prev) => {
      if (prev) return prev;
      window.setTimeout(() => {
        onClose();
      }, 190);
      return true;
    });
  }, [onClose]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [requestClose]);

  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const activeSet = match.sets.find((s) => s.setNumber === match.currentSet);
  const matchReports = reports.filter((r) => r.matchId === match.id);
  const maxSetCols = Math.max(3, match.sets.length);
  const setColumns = Array.from({ length: maxSetCols }, (_, i) => i + 1);

  return (
    <div
      onClick={requestClose}
      className={`fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 backdrop-blur-sm sm:items-center sm:p-4 ${
        isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-center-title"
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900 ${
          isClosing ? 'animate-sheet-down' : 'animate-sheet-up'
        }`}
      >
        {/* Top Broadcast Header */}
        <div className="relative overflow-hidden border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-5 py-4 text-white">
          <img
            src="/brand/svc-net-official.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -left-4 -top-4 h-28 w-28 object-contain opacity-20"
          />
          <div className="mx-auto mb-2.5 h-1.5 w-12 rounded-full bg-slate-700 sm:hidden" />

          <div className="relative flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="sport-skew inline-block rounded bg-amber-500 px-2.5 py-0.5 text-xs font-extrabold uppercase text-slate-950">
                <span className="sport-unskew">{match.courtName}</span>
              </span>
              <h3
                id="match-center-title"
                className="text-xs font-bold uppercase tracking-wider text-slate-200"
              >
                {categoryName || 'SVC'} •{' '}
                {formatInternationalStageLabel(match, totalMainRounds ?? 3)}
              </h3>
              {isLive && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-extrabold text-white">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  LIVE • SET {match.currentSet}
                </span>
              )}
              {isFinished && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-extrabold text-amber-300">
                  <Trophy className="h-3 w-3" /> FINAL SCORE
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={requestClose}
              aria-label="Tutup rincian pertandingan"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-200 transition hover:bg-slate-700 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Main Broadcast Scorebug */}
          <div className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <TeamAvatar team={teamA} size="lg" />
                {isLive && match.servingTeam === 'A' && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow">
                    <VolleyballIcon className="h-3 w-3" />
                  </span>
                )}
              </div>
              <p className="mt-2 font-display text-lg font-extrabold uppercase tracking-wide">
                {teamA?.name || 'Menunggu'}
              </p>
              {teamA?.school && (
                <p className="text-xs text-slate-300">{teamA.school}</p>
              )}
            </div>

            <div className="flex flex-col items-center">
              {isLive && activeSet ? (
                <>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-amber-300">
                    Poin Set {match.currentSet}
                  </span>
                  <div className="font-display text-5xl font-extrabold tabular-nums">
                    <span className={match.servingTeam === 'A' ? 'text-amber-400' : ''}>
                      {activeSet.scoreA}
                    </span>
                    <span className="mx-2 text-2xl text-slate-500">:</span>
                    <span className={match.servingTeam === 'B' ? 'text-amber-400' : ''}>
                      {activeSet.scoreB}
                    </span>
                  </div>
                  <span className="mt-1 rounded bg-slate-800 px-2.5 py-0.5 text-xs font-bold text-amber-300">
                    SET {match.setsWonA} - {match.setsWonB}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
                    {isFinished ? 'Skor Akhir Set' : match.scheduledAt || 'Terjadwal'}
                  </span>
                  <div className="mt-1 font-display text-5xl font-extrabold tabular-nums text-amber-400">
                    {match.setsWonA} <span className="text-2xl text-slate-500">-</span>{' '}
                    {match.setsWonB}
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <TeamAvatar team={teamB} size="lg" />
                {isLive && match.servingTeam === 'B' && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow">
                    <VolleyballIcon className="h-3 w-3" />
                  </span>
                )}
              </div>
              <p className="mt-2 font-display text-lg font-extrabold uppercase tracking-wide">
                {teamB?.name || 'Menunggu'}
              </p>
              {teamB?.school && (
                <p className="text-xs text-slate-300">{teamB.school}</p>
              )}
            </div>
          </div>
        </div>

        {/* Modal Body: Box Score Table + Actions + Match Photos */}
        <div className="space-y-5 p-5">
          {/* Official FIVB/VNL Style Box Score Table */}
          <div>
            <h4 className="mb-2 font-display text-sm font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Tabel Rincian Skor Per Set
            </h4>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="bg-slate-100 font-bold uppercase text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2">Tim</th>
                    {setColumns.map((num) => (
                      <th key={num} className="px-2.5 py-2 text-center">
                        S{num}
                      </th>
                    ))}
                    <th className="bg-amber-500/15 px-3 py-2 text-center text-amber-800 dark:text-amber-300">
                      SET
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(
                    [
                      { team: teamA, side: 'A' as const, setsWon: match.setsWonA },
                      { team: teamB, side: 'B' as const, setsWon: match.setsWonB },
                    ]
                  ).map(({ team, side, setsWon }) => (
                    <tr
                      key={side}
                      className={
                        match.winnerId && match.winnerId === team?.id
                          ? 'bg-amber-500/8 font-bold'
                          : ''
                      }
                    >
                      <td className="flex items-center gap-2 px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                        <span
                          className="h-4 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: team?.color || '#E09D17' }}
                        />
                        <span className="truncate">{team?.name || 'Menunggu'}</span>
                      </td>
                      {setColumns.map((num) => {
                        const s = match.sets.find((x) => x.setNumber === num);
                        const val = s ? (side === 'A' ? s.scoreA : s.scoreB) : '-';
                        const other = s ? (side === 'A' ? s.scoreB : s.scoreA) : -1;
                        const wonSet =
                          s && typeof val === 'number' && val > other && s.isFinished;
                        return (
                          <td
                            key={num}
                            className={`px-2.5 py-2.5 text-center ${
                              wonSet
                                ? 'font-extrabold text-amber-800 dark:text-amber-300'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {val}
                          </td>
                        );
                      })}
                      <td className="bg-amber-500/12 px-3 py-2.5 text-center font-display text-base font-extrabold text-amber-800 dark:text-amber-300">
                        {setsWon}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {onJumpToBracket && match.bracketType !== 'pool' && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onJumpToBracket(match.id);
                }}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-800 transition hover:border-amber-600 hover:text-amber-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-amber-300"
              >
                <GitBranch className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                Lihat Posisi di Bagan
              </button>
            )}

            {settings &&
              settings.publicDocsEnabled !== false &&
              (isFinished || isLive) && (
                <button
                  type="button"
                  disabled={downloadingPdf}
                  onClick={async () => {
                    if (downloadingPdf || !settings) return;
                    setDownloadingPdf(true);
                    try {
                      const { downloadMatchSummaryPdf } = await import(
                        '../lib/pdfDocuments'
                      );
                      await downloadMatchSummaryPdf(match, {
                        settings,
                        tournament: tournament ?? undefined,
                        teamA: teamA ?? undefined,
                        teamB: teamB ?? undefined,
                        totalMainRounds: totalMainRounds ?? 3,
                      });
                    } finally {
                      setDownloadingPdf(false);
                    }
                  }}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-sm transition hover:bg-amber-400 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {downloadingPdf
                    ? 'Generating PDF...'
                    : 'Match Summary (PDF)'}
                </button>
              )}
          </div>

          {/* Match Live Report Photos */}
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 font-display text-sm font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              <Camera className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              Momen Pertandingan Ini ({matchReports.length})
            </h4>
            {matchReports.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                Belum ada foto atau video dokumentasi untuk pertandingan ini.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {matchReports.map((rep) => (
                  <GalleryMediaCard key={rep.id} report={rep} compact />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

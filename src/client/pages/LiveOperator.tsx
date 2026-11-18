import {
  ArrowLeftRight,
  CheckCircle2,
  FileText,
  Minus,
  Monitor,
  Play,
  Plus,
  RotateCcw,
  Timer,
  Undo2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatInternationalStageLabel } from '../../shared/stages';
import { TeamAvatar } from '../components/TeamAvatar';
import { VolleyballIcon } from '../components/VolleyballIcon';
import { apiFetch } from '../lib/api';
import type { Match, OverviewData, Team } from '../types';

interface LiveOperatorProps {
  data: OverviewData;
  onRefresh: () => Promise<void>;
}

export function LiveOperator({ data, onRefresh }: LiveOperatorProps) {
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(() => {
    const firstLive = data.matches.find((m) => m.status === 'live');
    if (firstLive) return firstLive.id;
    const firstReady = data.matches.find(
      (m) => m.status === 'scheduled' && m.teamAId && m.teamBId
    );
    return firstReady?.id ?? null;
  });

  const [busy, setBusy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setDecisionPrompt, setSetDecisionPrompt] = useState<{
    setNumber: number;
    scoreA: number;
    scoreB: number;
    leadingSide: 'A' | 'B';
    willWinMatch: boolean;
  } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    type: 'finish' | 'reset';
    winnerSide?: 'A' | 'B';
  } | null>(null);

  const playableMatches = data.matches.filter(
    (m) => m.status !== 'bye' && m.teamAId && m.teamBId
  );
  const activeMatch: Match | undefined =
    playableMatches.find((m) => m.id === selectedMatchId) ?? playableMatches[0];

  const teamMap = new Map<number, Team>(data.teams.map((t) => [t.id, t]));
  const tournamentMap = new Map(data.tournaments.map((t) => [t.id, t]));

  const teamA = activeMatch?.teamAId ? teamMap.get(activeMatch.teamAId) : null;
  const teamB = activeMatch?.teamBId ? teamMap.get(activeMatch.teamBId) : null;
  const activeTournament = activeMatch
    ? tournamentMap.get(activeMatch.tournamentId)
    : null;
  const activeSet = activeMatch?.sets.find(
    (s) => s.setNumber === activeMatch.currentSet
  );

  // Pre-start per-match rule state (inherits tournament default)
  const [matchBestOf, setMatchBestOf] = useState<number>(3);
  const [matchRegPts, setMatchRegPts] = useState<number>(25);
  const [matchDecPts, setMatchDecPts] = useState<number>(15);
  const [matchDeuce, setMatchDeuce] = useState<boolean>(true);
  const [tvPinValue, setTvPinValue] = useState<string>(
    data.settings?.tvPin || '4426'
  );
  const [tvPinSaved, setTvPinSaved] = useState(false);

  const handleSaveTvPin = async () => {
    setError(null);
    try {
      await apiFetch('/api/admin/tv-pin', {
        method: 'PUT',
        body: JSON.stringify({ tvPin: tvPinValue }),
      });
      setTvPinSaved(true);
      setTimeout(() => setTvPinSaved(false), 2500);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (!activeMatch || !activeTournament) return;
    setMatchBestOf(activeMatch.bestOf ?? activeTournament.bestOf);
    setMatchRegPts(activeMatch.regularSetPoints ?? activeTournament.regularSetPoints);
    setMatchDecPts(activeMatch.decidingSetPoints ?? activeTournament.decidingSetPoints);
    setMatchDeuce(activeMatch.useDeuce ?? activeTournament.useDeuce);
  }, [activeMatch?.id, activeTournament?.id]);

  const effectiveBestOf = activeMatch?.bestOf ?? activeTournament?.bestOf ?? 3;
  const effectiveRegPts =
    activeMatch?.regularSetPoints ?? activeTournament?.regularSetPoints ?? 25;
  const effectiveDecPts =
    activeMatch?.decidingSetPoints ?? activeTournament?.decidingSetPoints ?? 15;
  const effectiveDeuce = activeMatch?.useDeuce ?? activeTournament?.useDeuce ?? true;

  const runAction = async (
    action:
      | 'start'
      | 'point'
      | 'timeout'
      | 'sub'
      | 'undo'
      | 'serve'
      | 'finish'
      | 'reset'
      | 'extra_set'
      | 'confirm_set_next'
      | 'confirm_match_finish',
    extra?: {
      team?: 'A' | 'B';
      delta?: 1 | -1;
      rules?: {
        bestOf: number;
        regularSetPoints: number;
        decidingSetPoints: number;
        useDeuce: boolean;
      };
    }
  ) => {
    if (!activeMatch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{
        match: Match & {
          pendingDecision?: {
            setNumber: number;
            scoreA: number;
            scoreB: number;
            leadingSide: 'A' | 'B';
            willWinMatch: boolean;
          };
        };
      }>(`/api/admin/matches/${activeMatch.id}/score`, {
        method: 'POST',
        body: JSON.stringify({ action, ...extra }),
      });
      await onRefresh();

      if (res.match?.pendingDecision) {
        setSetDecisionPrompt(res.match.pendingDecision);
      } else if (
        action === 'extra_set' ||
        action === 'confirm_set_next' ||
        action === 'confirm_match_finish'
      ) {
        setSetDecisionPrompt(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setConfirmModal(null);
    }
  };

  const updateCourt = async (courtName: string) => {
    if (!activeMatch) return;
    await apiFetch(`/api/admin/matches/${activeMatch.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ courtName }),
    });
    await onRefresh();
  };

  return (
    <div className="space-y-5">
      {/* Match Selector Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Pilih Pertandingan (Multi-Lapangan)
          </label>
          <select
            value={activeMatch?.id ?? ''}
            onChange={(e) => setSelectedMatchId(Number(e.target.value))}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            {playableMatches.length === 0 && (
              <option value="">Belum ada pertandingan siap dimainkan</option>
            )}
            {playableMatches.map((m) => {
              const tA = m.teamAId ? teamMap.get(m.teamAId)?.name : 'TBD';
              const tB = m.teamBId ? teamMap.get(m.teamBId)?.name : 'TBD';
              const cat = tournamentMap.get(m.tournamentId)?.name || '';
              const statusLabel =
                m.status === 'live'
                  ? 'LIVE'
                  : m.status === 'finished'
                    ? 'SELESAI'
                    : 'JADWAL';
              return (
                <option key={m.id} value={m.id}>
                  [{statusLabel}] {cat} • {m.courtName} • {tA} vs {tB}
                </option>
              );
            })}
          </select>
        </div>

        {activeMatch && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Lapangan
              </label>
              <select
                value={activeMatch.courtName}
                onChange={(e) => updateCourt(e.target.value)}
                className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                <option value="Court 1">Court 1</option>
                <option value="Court 2">Court 2</option>
                <option value="Court 3">Court 3</option>
                <option value="Main Arena">Main Arena</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                PIN TV
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={tvPinValue}
                  onChange={(e) => setTvPinValue(e.target.value)}
                  className="min-h-11 w-20 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-center font-mono text-sm font-bold dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={handleSaveTvPin}
                  className="min-h-11 rounded-xl border border-slate-300 px-3 text-xs font-bold hover:border-amber-600 dark:border-slate-700"
                >
                  {tvPinSaved ? 'Tersimpan' : 'Set'}
                </button>
              </div>
            </div>
            <a
              href={`/tv?match=${activeMatch.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Buka Layar Skor TV / Proyektor"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 text-xs font-bold text-amber-400 transition hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
            >
              <Monitor className="h-4 w-4" />
              Layar TV ↗
            </a>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {activeMatch ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          {/* Status & Rules Info */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                {activeTournament?.name} •{' '}
                {(() => {
                  const mr = data.matches
                    .filter(
                      (m) =>
                        m.tournamentId === activeMatch.tournamentId &&
                        m.bracketType === 'main'
                    )
                    .map((m) => m.round);
                  const tr = mr.length > 0 ? Math.max(...mr) : 3;
                  return formatInternationalStageLabel(activeMatch, tr);
                })()}
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Best of {effectiveBestOf} • Target{' '}
                {activeMatch.currentSet === effectiveBestOf
                  ? effectiveDecPts
                  : effectiveRegPts}{' '}
                poin {effectiveDeuce ? '(Deuce selisih 2)' : '(Tanpa Deuce)'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(activeMatch.status === 'live' ||
                activeMatch.status === 'finished') && (
                <button
                  type="button"
                  disabled={downloadingPdf}
                  onClick={async () => {
                    if (downloadingPdf) return;
                    setDownloadingPdf(true);
                    try {
                      const mainRounds = data.matches
                        .filter(
                          (m) =>
                            m.tournamentId === activeMatch.tournamentId &&
                            m.bracketType === 'main'
                        )
                        .map((m) => m.round);
                      const totalMainRounds =
                        mainRounds.length > 0 ? Math.max(...mainRounds) : 3;
                      const { downloadMatchSummaryPdf } = await import(
                        '../lib/pdfDocuments'
                      );
                      await downloadMatchSummaryPdf(activeMatch, {
                        settings: data.settings,
                        tournament: activeTournament ?? undefined,
                        teamA: teamA ?? undefined,
                        teamB: teamB ?? undefined,
                        totalMainRounds,
                      });
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setDownloadingPdf(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/12 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-500 hover:text-slate-950 disabled:opacity-50 dark:text-amber-300 dark:hover:text-slate-950"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {downloadingPdf ? 'Mencetak...' : 'Cetak Berita Acara PDF'}
                </button>
              )}
              {activeMatch.status === 'scheduled' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction('start', {
                      rules: {
                        bestOf: matchBestOf,
                        regularSetPoints: matchRegPts,
                        decidingSetPoints: matchDecPts,
                        useDeuce: matchDeuce,
                      },
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-emerald-500"
                >
                  <Play className="h-3.5 w-3.5" />
                  Mulai Pertandingan
                </button>
              )}

              <button
                type="button"
                disabled={busy || !activeMatch.undoCount}
                onClick={() => runAction('undo')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Undo ({activeMatch.undoCount ?? 0})
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmModal({ type: 'reset' })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-red-500/40 hover:text-red-500 dark:border-slate-700 dark:text-slate-400"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </div>
          </div>

          {/* Pre-Start Local Rule Override Panel */}
          {activeMatch.status === 'scheduled' && (
            <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 dark:bg-amber-500/10">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Aturan Poin Pertandingan Ini (Sebelum Mulai)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setMatchBestOf(3);
                      setMatchRegPts(15);
                      setMatchDecPts(15);
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                      matchBestOf === 3 && matchRegPts === 15
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200'
                    }`}
                  >
                    15 Poin (Penyisihan / QF)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMatchBestOf(3);
                      setMatchRegPts(25);
                      setMatchDecPts(15);
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                      matchBestOf === 3 && matchRegPts === 25
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200'
                    }`}
                  >
                    25 Poin (SF / Final)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMatchBestOf(5);
                      setMatchRegPts(25);
                      setMatchDecPts(15);
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                      matchBestOf === 5 && matchRegPts === 25
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200'
                    }`}
                  >
                    Bo5 Final (25/15)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Format
                  </label>
                  <select
                    value={matchBestOf}
                    onChange={(e) => setMatchBestOf(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value={1}>1 Set (1-0)</option>
                    <option value={3}>Best of 3 (2-0 / 2-1)</option>
                    <option value={5}>Best of 5 (3-0..3-2)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Target Set Biasa
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={50}
                    value={matchRegPts}
                    onChange={(e) => setMatchRegPts(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Set Penentuan
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={30}
                    value={matchDecPts}
                    onChange={(e) => setMatchDecPts(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={matchDeuce}
                      onChange={(e) => setMatchDeuce(e.target.checked)}
                    />
                    Deuce selisih 2
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Scoreboard Control Grid */}
          <div className="grid gap-4 md:grid-cols-2">
            {(['A', 'B'] as const).map((side) => {
              const team = side === 'A' ? teamA : teamB;
              const setsWon = side === 'A' ? activeMatch.setsWonA : activeMatch.setsWonB;
              const currentPts =
                side === 'A' ? (activeSet?.scoreA ?? 0) : (activeSet?.scoreB ?? 0);
              const isServing = activeMatch.servingTeam === side;

              return (
                <div
                  key={side}
                  className={`flex flex-col justify-between rounded-2xl border p-4 transition ${
                    isServing
                      ? 'border-amber-500/70 bg-amber-500/5 dark:bg-amber-500/10'
                      : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <TeamAvatar team={team} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold text-slate-900 dark:text-white">
                          {team?.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Set Dimenangkan: <strong className="text-amber-500">{setsWon}</strong>
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busy || activeMatch.status === 'finished'}
                      onClick={() => runAction('serve', { team: side })}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                        isServing
                          ? 'bg-amber-500 text-slate-950 shadow-sm'
                          : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <VolleyballIcon className="h-3.5 w-3.5" />
                        {isServing ? 'Servis' : 'Set Servis'}
                      </span>
                    </button>
                  </div>

                  {/* Big Score Display */}
                  <div className="my-5 text-center font-display text-7xl font-extrabold leading-none tabular-nums text-slate-900 dark:text-white">
                    {currentPts}
                  </div>

                  {/* +1 / -1 Touch Controls */}
                  <div className="grid grid-cols-[1fr_2fr] gap-2.5">
                    <button
                      type="button"
                      disabled={busy || activeMatch.status === 'finished' || currentPts <= 0}
                      onClick={() => runAction('point', { team: side, delta: -1 })}
                      className="flex h-14 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition active:scale-95 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <Minus className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || activeMatch.status === 'finished'}
                      onClick={() => runAction('point', { team: side, delta: 1 })}
                      className="flex h-14 items-center justify-center gap-2 rounded-xl bg-amber-500 font-display text-2xl font-extrabold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 active:scale-95 disabled:opacity-40"
                    >
                      <Plus className="h-6 w-6" />
                      POIN
                    </button>
                  </div>

                  {/* Per-Set Time-Out (0..2) & Substitution (0..6) Counters */}
                  {activeMatch.status === 'live' && activeSet && (
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800">
                      {(() => {
                        const toUsed =
                          side === 'A'
                            ? (activeSet.timeoutsA ?? 0)
                            : (activeSet.timeoutsB ?? 0);
                        const subUsed =
                          side === 'A'
                            ? (activeSet.subsA ?? 0)
                            : (activeSet.subsB ?? 0);

                        return (
                          <>
                            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                                <Timer className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                <span>
                                  T/O{' '}
                                  <strong className="tabular-nums text-amber-700 dark:text-amber-300">
                                    {toUsed}/2
                                  </strong>
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={busy || toUsed <= 0}
                                  aria-label={`Kurangi timeout ${team?.name || side}`}
                                  onClick={() =>
                                    runAction('timeout', { team: side, delta: -1 })
                                  }
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || toUsed >= 2}
                                  aria-label={`Tambah timeout ${team?.name || side}`}
                                  onClick={() =>
                                    runAction('timeout', { team: side, delta: 1 })
                                  }
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-35 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                                <ArrowLeftRight className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                                <span>
                                  SUB{' '}
                                  <strong className="tabular-nums text-sky-700 dark:text-sky-300">
                                    {subUsed}/6
                                  </strong>
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={busy || subUsed <= 0}
                                  aria-label={`Kurangi substitusi ${team?.name || side}`}
                                  onClick={() =>
                                    runAction('sub', { team: side, delta: -1 })
                                  }
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || subUsed >= 6}
                                  aria-label={`Tambah substitusi ${team?.name || side}`}
                                  onClick={() =>
                                    runAction('sub', { team: side, delta: 1 })
                                  }
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-35 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Manual Finish / Extra Set Option */}
          {activeMatch.status !== 'finished' ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Set {activeMatch.currentSet} sedang aktif. Pemenang otomatis maju ke bagan saat match selesai.
              </p>
              <div className="flex flex-wrap gap-2">
                {activeSet && activeSet.scoreA !== activeSet.scoreB && (
                  <button
                    type="button"
                    onClick={() => {
                      const leadingSide = activeSet.scoreA > activeSet.scoreB ? 'A' : 'B';
                      const setsNeeded = Math.ceil(effectiveBestOf / 2);
                      const projA = activeMatch.setsWonA + (leadingSide === 'A' ? 1 : 0);
                      const projB = activeMatch.setsWonB + (leadingSide === 'B' ? 1 : 0);
                      setSetDecisionPrompt({
                        setNumber: activeMatch.currentSet,
                        scoreA: activeSet.scoreA,
                        scoreB: activeSet.scoreB,
                        leadingSide,
                        willWinMatch: projA >= setsNeeded || projB >= setsNeeded,
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-600 hover:bg-amber-500/25 dark:text-amber-400"
                  >
                    Tutup Set {activeMatch.currentSet}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmModal({ type: 'finish', winnerSide: 'A' })}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-amber-500 dark:border-slate-700 dark:text-slate-200"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-amber-500" />
                  Menangkan {teamA?.shortCode}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmModal({ type: 'finish', winnerSide: 'B' })}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-amber-500 dark:border-slate-700 dark:text-slate-200"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-amber-500" />
                  Menangkan {teamB?.shortCode}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                Pertandingan selesai ({activeMatch.setsWonA} - {activeMatch.setsWonB}). Ingin menambah 1 set lagi?
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction('extra_set')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-bold text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
              >
                <Plus className="h-3.5 w-3.5" />
                +1 Set Tambahan
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800">
          Buat bagan turnamen terlebih dahulu di menu <strong>Kategori &amp; Bagan</strong>.
        </div>
      )}

      {/* Referee Set Decision Prompt: Desktop Pop-up + Mobile Bottom Sheet */}
      {setDecisionPrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="animate-sheet-up w-full rounded-t-3xl border border-slate-200 bg-white p-5 pb-7 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:max-w-md sm:rounded-2xl sm:pb-5">
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />
            <span className="inline-flex rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
              Konfirmasi Set {setDecisionPrompt.setNumber}
            </span>
            <h3 className="mt-2 font-display text-xl font-extrabold uppercase text-slate-900 dark:text-white">
              {teamA?.shortCode} {setDecisionPrompt.scoreA} - {setDecisionPrompt.scoreB}{' '}
              {teamB?.shortCode}
            </h3>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              {setDecisionPrompt.willWinMatch
                ? `${
                    setDecisionPrompt.leadingSide === 'A' ? teamA?.name : teamB?.name
                  } unggul dan siap memenangkan pertandingan. Pilih tindakan selanjutnya:`
                : `Target poin Set ${setDecisionPrompt.setNumber} sudah tercapai. Pilih apakah lanjut ke Set ${
                    setDecisionPrompt.setNumber + 1
                  }, akhiri pertandingan, atau lanjutkan permainan di set ini:`}
            </p>

            <div className="mt-5 flex flex-col gap-2">
              {setDecisionPrompt.willWinMatch ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction('confirm_match_finish')}
                  className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  Selesaikan Pertandingan &amp; Loloskan Pemenang
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction('confirm_set_next')}
                  className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  Tutup Set {setDecisionPrompt.setNumber} &amp; Lanjut Set{' '}
                  {setDecisionPrompt.setNumber + 1}
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runAction(
                    setDecisionPrompt.willWinMatch
                      ? 'confirm_set_next'
                      : 'confirm_match_finish'
                  )
                }
                className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
              >
                {setDecisionPrompt.willWinMatch
                  ? `Tambah 1 Set Baru (Lanjut Set ${setDecisionPrompt.setNumber + 1})`
                  : 'Akhiri Pertandingan Sekarang'}
              </button>

              <button
                type="button"
                onClick={() => setSetDecisionPrompt(null)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Lanjutkan Permainan di Set {setDecisionPrompt.setNumber}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal (Desktop Pop-up + Mobile Bottom Sheet) */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="animate-sheet-up w-full rounded-t-3xl border border-slate-200 bg-white p-5 pb-7 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:max-w-sm sm:rounded-2xl sm:pb-5">
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {confirmModal.type === 'reset'
                ? 'Reset Skor Pertandingan?'
                : 'Selesaikan Pertandingan?'}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {confirmModal.type === 'reset'
                ? 'Semua poin dan set pada pertandingan ini akan dikembalikan ke 0.'
                : `Tim ${
                    confirmModal.winnerSide === 'A' ? teamA?.name : teamB?.name
                  } akan dinyatakan menang dan otomatis lolos ke babak berikutnya.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  confirmModal.type === 'reset'
                    ? runAction('reset')
                    : runAction('finish', { team: confirmModal.winnerSide })
                }
                className={`rounded-xl px-4 py-2 text-xs font-bold text-white ${
                  confirmModal.type === 'reset'
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                }`}
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

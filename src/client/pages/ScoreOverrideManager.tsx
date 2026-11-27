import {
  Calculator,
  CheckCircle2,
  Minus,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { groupMatchesByScheduleDay } from '../../shared/schedule';
import { formatInternationalStageLabel } from '../../shared/stages';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TeamAvatar } from '../components/TeamAvatar';
import { apiFetch } from '../lib/api';
import type { Match, OverviewData, Team } from '../types';

interface ScoreOverrideManagerProps {
  data: OverviewData;
  onRefresh: () => Promise<void>;
}

interface EditableSet {
  scoreA: number;
  scoreB: number;
  timeoutsA: number;
  timeoutsB: number;
  subsA: number;
  subsB: number;
  isFinished: boolean;
}

export function ScoreOverrideManager({ data, onRefresh }: ScoreOverrideManagerProps) {
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'live' | 'finished' | 'scheduled'
  >('all');
  const [courtFilter, setCourtFilter] = useState<string>('all');
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);

  const [sets, setSets] = useState<EditableSet[]>([]);
  const [currentSet, setCurrentSet] = useState<number>(1);
  const [setsWonA, setSetsWonA] = useState<number>(0);
  const [setsWonB, setSetsWonB] = useState<number>(0);
  const [status, setStatus] = useState<'scheduled' | 'live' | 'finished'>('scheduled');
  const [servingTeam, setServingTeam] = useState<'A' | 'B' | null>(null);
  const [winnerSide, setWinnerSide] = useState<'A' | 'B'>('A');

  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null
  );

  const teamMap = useMemo(
    () => new Map<number, Team>(data.teams.map((t) => [t.id, t])),
    [data.teams]
  );
  const tournamentMap = useMemo(
    () => new Map(data.tournaments.map((t) => [t.id, t])),
    [data.tournaments]
  );

  const playableMatches = useMemo(
    () => data.matches.filter((m) => m.status !== 'bye' && m.teamAId && m.teamBId),
    [data.matches]
  );

  const courtOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of data.masterCourts ?? []) names.add(c.name);
    for (const m of playableMatches) {
      if (m.courtName) names.add(m.courtName);
    }
    return Array.from(names);
  }, [data.masterCourts, playableMatches]);

  const filteredMatches = useMemo(() => {
    const base = playableMatches.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (courtFilter !== 'all' && m.courtName !== courtFilter) return false;
      return true;
    });
    const ordered = groupMatchesByScheduleDay(base).orderedMatches;
    return [...ordered].sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1;
      if (b.status === 'live' && a.status !== 'live') return 1;
      return 0;
    });
  }, [playableMatches, statusFilter, courtFilter]);

  useEffect(() => {
    if (filteredMatches.length === 0) {
      setSelectedMatchId(null);
      return;
    }
    if (!selectedMatchId || !filteredMatches.some((m) => m.id === selectedMatchId)) {
      setSelectedMatchId(filteredMatches[0]!.id);
    }
  }, [filteredMatches, selectedMatchId]);

  const activeMatch: Match | undefined = useMemo(
    () => playableMatches.find((m) => m.id === selectedMatchId),
    [playableMatches, selectedMatchId]
  );

  const loadDraftFromMatch = (m: Match) => {
    const sortedSets = [...(m.sets ?? [])].sort((a, b) => a.setNumber - b.setNumber);
    const mapped: EditableSet[] =
      sortedSets.length > 0
        ? sortedSets.map((s) => ({
            scoreA: s.scoreA ?? 0,
            scoreB: s.scoreB ?? 0,
            timeoutsA: s.timeoutsA ?? 0,
            timeoutsB: s.timeoutsB ?? 0,
            subsA: s.subsA ?? 0,
            subsB: s.subsB ?? 0,
            isFinished: Boolean(s.isFinished),
          }))
        : [
            {
              scoreA: 0,
              scoreB: 0,
              timeoutsA: 0,
              timeoutsB: 0,
              subsA: 0,
              subsB: 0,
              isFinished: false,
            },
          ];
    setSets(mapped);
    setCurrentSet(Math.max(1, Math.min(mapped.length, m.currentSet || 1)));
    setSetsWonA(m.setsWonA ?? 0);
    setSetsWonB(m.setsWonB ?? 0);
    setStatus(
      m.status === 'live' || m.status === 'finished' ? m.status : 'scheduled'
    );
    setServingTeam(m.servingTeam ?? null);
    setWinnerSide(
      m.winnerId && m.winnerId === m.teamBId
        ? 'B'
        : m.setsWonB > m.setsWonA
          ? 'B'
          : 'A'
    );
    setFeedback(null);
  };

  useEffect(() => {
    if (activeMatch) {
      loadDraftFromMatch(activeMatch);
    }
  }, [activeMatch?.id]);

  const teamA = activeMatch?.teamAId ? teamMap.get(activeMatch.teamAId) : null;
  const teamB = activeMatch?.teamBId ? teamMap.get(activeMatch.teamBId) : null;
  const activeTournament = activeMatch
    ? tournamentMap.get(activeMatch.tournamentId)
    : null;

  const autoCalculateSetsWon = () => {
    let wonA = 0;
    let wonB = 0;
    for (const s of sets) {
      if (s.isFinished && s.scoreA !== s.scoreB) {
        if (s.scoreA > s.scoreB) wonA += 1;
        else wonB += 1;
      }
    }
    setSetsWonA(wonA);
    setSetsWonB(wonB);
    setWinnerSide(wonB > wonA ? 'B' : 'A');
  };

  const updateSetField = <K extends keyof EditableSet>(
    idx: number,
    field: K,
    value: EditableSet[K]
  ) => {
    setSets((prev) =>
      prev.map((row, rIdx) => (rIdx === idx ? { ...row, [field]: value } : row))
    );
  };

  const addSetRow = () => {
    if (sets.length >= 5) return;
    setSets((prev) => [
      ...prev,
      {
        scoreA: 0,
        scoreB: 0,
        timeoutsA: 0,
        timeoutsB: 0,
        subsA: 0,
        subsB: 0,
        isFinished: false,
      },
    ]);
  };

  const removeSetRow = (idx: number) => {
    if (sets.length <= 1) return;
    setSets((prev) => {
      const next = prev.filter((_, rIdx) => rIdx !== idx);
      setCurrentSet((cur) => Math.max(1, Math.min(next.length, cur)));
      return next;
    });
  };

  const handleSaveOverride = async () => {
    if (!activeMatch || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/matches/${activeMatch.id}/override`, {
        method: 'POST',
        body: JSON.stringify({
          sets,
          currentSet,
          setsWonA,
          setsWonB,
          status,
          servingTeam,
          winnerSide: status === 'finished' ? winnerSide : null,
        }),
      });
      await onRefresh();
      setFeedback({
        type: 'ok',
        msg: `Override skor ${teamA?.shortCode || 'A'} vs ${teamB?.shortCode || 'B'} berhasil disimpan & disinkronkan ke TV/Bagan.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: (err as Error).message || 'Gagal menyimpan override skor.',
      });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="rounded-2xl border border-amber-500/35 bg-gradient-to-br from-amber-500/10 via-white to-white p-5 dark:from-amber-500/10 dark:via-slate-900 dark:to-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              Khusus Admin • Koreksi Darurat
            </span>
            <h2 className="mt-2 font-display text-xl font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
              Override Skor &amp; Set Pertandingan
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Edit manual poin per set, set aktif, total skor set, dan status pertandingan saat terjadi kesalahan input juri. Perubahan langsung disinkronkan ke Bagan, Layar TV, OBS, dan Portal Publik.
            </p>
          </div>
        </div>

        {/* Filters + Match Selector */}
        <div className="mt-4 grid gap-3 md:grid-cols-[auto_auto_1fr]">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Filter Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value as 'all' | 'live' | 'finished' | 'scheduled'
                )
              }
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="all">Semua Status</option>
              <option value="live">Sedang Live</option>
              <option value="finished">Sudah Selesai</option>
              <option value="scheduled">Terjadwal</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Filter Lapangan
            </label>
            <select
              value={courtFilter}
              onChange={(e) => setCourtFilter(e.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="all">Semua Lapangan</option>
              {courtOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Pilih Pertandingan ({filteredMatches.length})
            </label>
            <select
              value={activeMatch?.id ?? ''}
              onChange={(e) => setSelectedMatchId(Number(e.target.value))}
              className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
            >
              {filteredMatches.length === 0 && (
                <option value="">Tidak ada pertandingan sesuai filter</option>
              )}
              {filteredMatches.map((m) => {
                const tA = m.teamAId ? teamMap.get(m.teamAId)?.shortCode || 'A' : 'TBD';
                const tB = m.teamBId ? teamMap.get(m.teamBId)?.shortCode || 'B' : 'TBD';
                const tName = tournamentMap.get(m.tournamentId)?.name || '';
                const cur = m.sets.find((s) => s.setNumber === m.currentSet);
                const scoreSummary =
                  m.status === 'live' && cur
                    ? `LIVE S${m.currentSet} (${cur.scoreA}:${cur.scoreB})`
                    : m.status === 'finished'
                      ? `SELESAI (${m.setsWonA}-${m.setsWonB})`
                      : 'TERJADWAL';
                return (
                  <option key={m.id} value={m.id}>
                    [{m.courtName}] {tName} • {tA} vs {tB} — {scoreSummary}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-semibold ${
            feedback.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {activeMatch && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {/* Match Identity */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <TeamAvatar team={teamA} size="sm" />
                <span className="font-display text-base font-extrabold uppercase">
                  {teamA?.name || 'Tim A'}
                </span>
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-500 dark:bg-slate-800">
                VS
              </span>
              <div className="flex items-center gap-2">
                <TeamAvatar team={teamB} size="sm" />
                <span className="font-display text-base font-extrabold uppercase">
                  {teamB?.name || 'Tim B'}
                </span>
              </div>
            </div>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {activeTournament?.name} • {formatInternationalStageLabel(activeMatch, 4)} •{' '}
              {activeMatch.courtName}
            </div>
          </div>

          {/* Match-level Controls */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Status Match
              </label>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as 'scheduled' | 'live' | 'finished')
                }
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="scheduled">Terjadwal (Scheduled)</option>
                <option value="live">Sedang Main (Live)</option>
                <option value="finished">Selesai (Finished)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Set Aktif (Current Set)
              </label>
              <select
                value={currentSet}
                onChange={(e) => setCurrentSet(Number(e.target.value))}
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
              >
                {sets.map((_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Set {i + 1}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Servis Saat Ini
              </label>
              <select
                value={servingTeam ?? ''}
                onChange={(e) =>
                  setServingTeam(
                    e.target.value === 'A' || e.target.value === 'B'
                      ? e.target.value
                      : null
                  )
                }
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">Tidak Ditentukan</option>
                <option value="A">{teamA?.shortCode || 'Tim A'}</option>
                <option value="B">{teamB?.shortCode || 'Tim B'}</option>
              </select>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Skor Set ({teamA?.shortCode || 'A'} - {teamB?.shortCode || 'B'})
                </label>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={setsWonA}
                  onChange={(e) =>
                    setSetsWonA(Math.max(0, Math.min(5, Number(e.target.value) || 0)))
                  }
                  className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-center font-mono text-sm font-extrabold dark:border-slate-700 dark:bg-slate-950"
                />
                <span className="font-bold text-slate-400">-</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={setsWonB}
                  onChange={(e) =>
                    setSetsWonB(Math.max(0, Math.min(5, Number(e.target.value) || 0)))
                  }
                  className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-center font-mono text-sm font-extrabold dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={autoCalculateSetsWon}
                  title="Hitung otomatis skor set dari baris set yang selesai"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-sky-500/40 bg-sky-500/10 px-2.5 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300"
                >
                  <Calculator className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Pemenang (Jika Selesai)
              </label>
              <select
                disabled={status !== 'finished'}
                value={winnerSide}
                onChange={(e) => setWinnerSide(e.target.value as 'A' | 'B')}
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="A">{teamA?.name || 'Tim A'}</option>
                <option value="B">{teamB?.name || 'Tim B'}</option>
              </select>
            </div>
          </div>

          {/* Per-Set Score Editor */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Rincian Skor per Set ({sets.length} Set)
              </h3>
              <button
                type="button"
                disabled={sets.length >= 5}
                onClick={addSetRow}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-500/20 disabled:opacity-40 dark:text-amber-300"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Set
              </button>
            </div>

            <div className="space-y-2.5">
              {sets.map((row, idx) => {
                const setNum = idx + 1;
                const isCur = setNum === currentSet;
                return (
                  <div
                    key={setNum}
                    className={`rounded-xl border p-3 ${
                      isCur
                        ? 'border-amber-500/60 bg-amber-500/5 dark:bg-amber-500/10'
                        : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg bg-slate-900 px-2.5 py-1 font-mono text-xs font-extrabold text-amber-400 dark:bg-amber-500 dark:text-slate-950">
                          SET {setNum}
                        </span>
                        {isCur && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-300">
                            Aktif
                          </span>
                        )}
                        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={row.isFinished}
                            onChange={(e) =>
                              updateSetField(idx, 'isFinished', e.target.checked)
                            }
                          />
                          Set Selesai
                        </label>
                      </div>

                      <button
                        type="button"
                        disabled={sets.length <= 1}
                        onClick={() => removeSetRow(idx)}
                        aria-label={`Hapus Set ${setNum}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-500 hover:border-red-500/40 hover:text-red-500 disabled:opacity-35 dark:border-slate-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Hapus
                      </button>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          ['A', teamA?.shortCode || 'Tim A', 'scoreA', 'timeoutsA', 'subsA'],
                          ['B', teamB?.shortCode || 'Tim B', 'scoreB', 'timeoutsB', 'subsB'],
                        ] as const
                      ).map(([sideKey, label, scoreField, toField, subField]) => (
                        <div
                          key={sideKey}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <span className="text-xs font-extrabold uppercase text-slate-700 dark:text-slate-200">
                            {label}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                updateSetField(
                                  idx,
                                  scoreField,
                                  Math.max(0, row[scoreField] - 1)
                                )
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={99}
                              value={row[scoreField]}
                              onChange={(e) =>
                                updateSetField(
                                  idx,
                                  scoreField,
                                  Math.max(0, Math.min(99, Number(e.target.value) || 0))
                                )
                              }
                              className="h-8 w-14 rounded-lg border border-slate-200 bg-slate-50 text-center font-mono text-sm font-extrabold dark:border-slate-700 dark:bg-slate-950"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateSetField(
                                  idx,
                                  scoreField,
                                  Math.min(99, row[scoreField] + 1)
                                )
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                            <label className="flex items-center gap-1">
                              T/O
                              <input
                                type="number"
                                min={0}
                                max={2}
                                value={row[toField]}
                                onChange={(e) =>
                                  updateSetField(
                                    idx,
                                    toField,
                                    Math.max(0, Math.min(2, Number(e.target.value) || 0))
                                  )
                                }
                                className="h-7 w-10 rounded border border-slate-200 bg-slate-50 text-center font-mono text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                              />
                            </label>
                            <label className="flex items-center gap-1">
                              SUB
                              <input
                                type="number"
                                min={0}
                                max={6}
                                value={row[subField]}
                                onChange={(e) =>
                                  updateSetField(
                                    idx,
                                    subField,
                                    Math.max(0, Math.min(6, Number(e.target.value) || 0))
                                  )
                                }
                                className="h-7 w-10 rounded border border-slate-200 bg-slate-50 text-center font-mono text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-4 dark:border-slate-800">
            <button
              type="button"
              disabled={busy}
              onClick={() => loadDraftFromMatch(activeMatch)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset ke Nilai Awal
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg shadow-amber-500/20 hover:bg-amber-400 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Simpan Override Skor
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Terapkan Override Skor?"
        message={`Skor ${teamA?.shortCode || 'Tim A'} vs ${teamB?.shortCode || 'Tim B'} akan diperbarui menjadi Set ${setsWonA}-${setsWonB} (${sets.map((s, i) => `S${i + 1}: ${s.scoreA}-${s.scoreB}`).join(', ')}), Set Aktif ${currentSet}, Status: ${status.toUpperCase()}. Bagan & Layar TV akan langsung disinkronkan.`}
        variant="warning"
        busy={busy}
        confirmLabel={busy ? 'Menyimpan...' : 'Ya, Simpan Override'}
        onCancel={() => !busy && setConfirmOpen(false)}
        onConfirm={handleSaveOverride}
      />
    </div>
  );
}

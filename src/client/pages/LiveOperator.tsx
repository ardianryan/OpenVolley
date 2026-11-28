import {
  ArrowLeft,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FileText,
  MapPin,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Timer,
  Undo2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { groupMatchesByScheduleDay } from '../../shared/schedule';
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
  const [selectedCourtName, setSelectedCourtName] = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [scheduleFilter, setScheduleFilter] = useState<'active' | 'finished' | 'all'>(
    'active'
  );

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
    type: 'finish' | 'reset' | 'extra_set';
    winnerSide?: 'A' | 'B';
  } | null>(null);

  useEffect(() => {
    if (!confirmModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setConfirmModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmModal, busy]);

  const playableMatches = useMemo(
    () =>
      data.matches.filter((m) => m.status !== 'bye' && m.teamAId && m.teamBId),
    [data.matches]
  );

  // Build unified court cards list from Master Courts + any legacy courtName present in playable matches
  const courtCards = useMemo(() => {
    const map = new Map<
      string,
      { name: string; shortCode: string; matches: Match[] }
    >();
    for (const c of data.masterCourts ?? []) {
      map.set(c.name, { name: c.name, shortCode: c.shortCode, matches: [] });
    }
    for (const m of playableMatches) {
      const cName = m.courtName || 'Lapangan 1';
      if (!map.has(cName)) {
        map.set(cName, {
          name: cName,
          shortCode: cName.slice(0, 8).toUpperCase(),
          matches: [],
        });
      }
      map.get(cName)!.matches.push(m);
    }
    return Array.from(map.values());
  }, [data.masterCourts, playableMatches]);

  const courtMatches = useMemo(() => {
    if (!selectedCourtName) return [];
    const onCourt = playableMatches.filter((m) => m.courtName === selectedCourtName);
    const filtered = onCourt.filter((m) => {
      if (scheduleFilter === 'active') return m.status !== 'finished';
      if (scheduleFilter === 'finished') return m.status === 'finished';
      return true;
    });
    const ordered = groupMatchesByScheduleDay(filtered).orderedMatches;
    // Always float currently LIVE matches to top for fast selection
    return [...ordered].sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1;
      if (b.status === 'live' && a.status !== 'live') return 1;
      return 0;
    });
  }, [selectedCourtName, playableMatches, scheduleFilter]);

  const activeMatch: Match | undefined =
    selectedMatchId !== null
      ? playableMatches.find((m) => m.id === selectedMatchId)
      : undefined;

  const teamMap = useMemo(
    () => new Map<number, Team>(data.teams.map((t) => [t.id, t])),
    [data.teams]
  );
  const tournamentMap = useMemo(
    () => new Map(data.tournaments.map((t) => [t.id, t])),
    [data.tournaments]
  );

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

  // Local scorer court-side orientation (keeps database & TV/OBS Team A/B accurate)
  const [swappedSides, setSwappedSides] = useState<boolean>(false);
  const [compactTwoColMobile, setCompactTwoColMobile] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('openvolley:live-2col-mobile') === '1';
    } catch {
      return false;
    }
  });
  const [switchReminder, setSwitchReminder] = useState<string | null>(null);
  const lastSetTrackerRef = useRef<{ matchId: number; set: number } | null>(null);
  const deciding8PromptedRef = useRef<number | null>(null);
  const cardRefs = useRef<Record<'A' | 'B', HTMLDivElement | null>>({
    A: null,
    B: null,
  });
  const flipRectsRef = useRef<{ A: DOMRect; B: DOMRect } | null>(null);
  const flipTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeMatch) {
      setSwappedSides(false);
      setSwitchReminder(null);
      return;
    }
    try {
      setSwappedSides(
        window.localStorage.getItem(`openvolley:court-swapped:${activeMatch.id}`) === '1'
      );
    } catch {
      setSwappedSides(false);
    }
    setSwitchReminder(null);
    lastSetTrackerRef.current = {
      matchId: activeMatch.id,
      set: activeMatch.currentSet,
    };
    deciding8PromptedRef.current = null;
  }, [activeMatch?.id]);

  const toggleSwappedSides = () => {
    const rectA = cardRefs.current.A?.getBoundingClientRect();
    const rectB = cardRefs.current.B?.getBoundingClientRect();
    if (rectA && rectB) {
      flipRectsRef.current = { A: rectA, B: rectB };
    }
    setSwappedSides((prev) => {
      const next = !prev;
      if (activeMatch) {
        try {
          window.localStorage.setItem(
            `openvolley:court-swapped:${activeMatch.id}`,
            next ? '1' : '0'
          );
        } catch {
          // ignore storage quota errors
        }
      }
      return next;
    });
    setSwitchReminder(null);
  };

  useLayoutEffect(() => {
    const prevRects = flipRectsRef.current;
    if (!prevRects) return;
    flipRectsRef.current = null;

    if (flipTimerRef.current !== null) {
      window.clearTimeout(flipTimerRef.current);
      flipTimerRef.current = null;
    }

    const animatedEls: HTMLDivElement[] = [];
    for (const side of ['A', 'B'] as const) {
      const el = cardRefs.current[side];
      if (!el) continue;
      const nextRect = el.getBoundingClientRect();
      const dx = prevRects[side].left - nextRect.left;
      const dy = prevRects[side].top - nextRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      el.style.transition = 'none';
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${side === 'A' ? 0.98 : 1.02})`;
      el.style.zIndex = side === 'A' ? '10' : '20';
      el.style.willChange = 'transform';
      animatedEls.push(el);
    }

    if (animatedEls.length === 0) return;
    // Force reflow so the inverted transform is committed before animating to 0
    void document.body.offsetHeight;

    const rafId = window.requestAnimationFrame(() => {
      for (const el of animatedEls) {
        el.style.transition = 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = 'translate3d(0, 0, 0) scale(1)';
      }
    });

    flipTimerRef.current = window.setTimeout(() => {
      for (const el of animatedEls) {
        el.style.transition = '';
        el.style.transform = '';
        el.style.zIndex = '';
        el.style.willChange = '';
      }
      flipTimerRef.current = null;
    }, 450);

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [swappedSides]);

  const toggleCompactTwoColMobile = () => {
    setCompactTwoColMobile((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('openvolley:live-2col-mobile', next ? '1' : '0');
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  };

  useEffect(() => {
    if (!activeMatch || activeMatch.status !== 'live') return;
    const prev = lastSetTrackerRef.current;
    if (prev && prev.matchId === activeMatch.id && activeMatch.currentSet > prev.set) {
      setSwitchReminder(
        `Memasuki Set ${activeMatch.currentSet} — apakah tim bertukar posisi lapangan?`
      );
    }
    lastSetTrackerRef.current = {
      matchId: activeMatch.id,
      set: activeMatch.currentSet,
    };
  }, [activeMatch?.id, activeMatch?.status, activeMatch?.currentSet]);

  useEffect(() => {
    if (!activeMatch || activeMatch.status !== 'live' || !activeSet) return;
    const isDecidingSet =
      effectiveBestOf > 1 && activeMatch.currentSet === effectiveBestOf;
    if (!isDecidingSet) return;
    const maxPts = Math.max(activeSet.scoreA, activeSet.scoreB);
    if (maxPts === 8 && deciding8PromptedRef.current !== activeMatch.id) {
      deciding8PromptedRef.current = activeMatch.id;
      setSwitchReminder(
        'Poin 8 Set Penentuan — apakah tim bertukar posisi lapangan?'
      );
    }
  }, [
    activeMatch?.id,
    activeMatch?.status,
    activeMatch?.currentSet,
    activeSet?.scoreA,
    activeSet?.scoreB,
    effectiveBestOf,
  ]);

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
    setSelectedCourtName(courtName);
    await onRefresh();
  };

  const currentStep: 1 | 2 | 3 = !selectedCourtName ? 1 : !activeMatch ? 2 : 3;

  return (
    <div className="space-y-5">
      {/* Guided 3-Step Operator Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setSelectedCourtName(null);
              setSelectedMatchId(null);
            }}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 py-1.5 transition sm:min-h-8 ${
              currentStep === 1
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            <span className="font-mono font-extrabold">1.</span>
            <span>Pilih Lapangan</span>
          </button>

          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />

          <button
            type="button"
            disabled={!selectedCourtName}
            onClick={() => setSelectedMatchId(null)}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 py-1.5 transition disabled:opacity-45 sm:min-h-8 ${
              currentStep === 2
                ? 'bg-amber-500 text-slate-950'
                : currentStep === 3
                  ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
                  : 'text-slate-400'
            }`}
          >
            <span className="font-mono font-extrabold">2.</span>
            <span>
              {selectedCourtName ? `Jadwal (${selectedCourtName})` : 'Pilih Jadwal'}
            </span>
          </button>

          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />

          <span
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 py-1.5 sm:min-h-8 ${
              currentStep === 3
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-400'
            }`}
          >
            <span className="font-mono font-extrabold">3.</span>
            <span>Konsol Skor Live</span>
          </span>
        </div>

        {currentStep === 3 && activeMatch && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedMatchId(null)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-amber-500 sm:min-h-8 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Ganti Jadwal
            </button>

            <select
              value={activeMatch.courtName}
              onChange={(e) => updateCourt(e.target.value)}
              aria-label="Pindah Lapangan Pertandingan"
              className="min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-900 sm:min-h-8 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              {(data.masterCourts && data.masterCourts.length > 0
                ? data.masterCourts
                : [
                    { id: -1, name: 'Lapangan 1' },
                    { id: -2, name: 'Lapangan 2' },
                  ]
              ).map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
              {activeMatch.courtName &&
                !(data.masterCourts ?? []).some(
                  (c) => c.name === activeMatch.courtName
                ) && (
                  <option value={activeMatch.courtName}>
                    {activeMatch.courtName}
                  </option>
                )}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* STEP 1: PILIH LAPANGAN */}
      {currentStep === 1 && (
        <div className="animate-page-enter space-y-4">
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 dark:bg-amber-500/10">
            <h2 className="font-display text-lg font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
              Langkah 1: Pilih Lapangan Bertanding
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
              Pilih lapangan tempat Anda bertugas untuk melihat jadwal pertandingan yang
              siap dipimpin.
            </p>
          </div>

          {courtCards.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              Belum ada lapangan terdaftar. Tambahkan lapangan di menu{' '}
              <strong>Master Lapangan &amp; Jadwal</strong>.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {courtCards.map((court) => {
                const liveCount = court.matches.filter(
                  (m) => m.status === 'live'
                ).length;
                const scheduledCount = court.matches.filter(
                  (m) => m.status === 'scheduled'
                ).length;
                const finishedCount = court.matches.filter(
                  (m) => m.status === 'finished'
                ).length;
                return (
                  <button
                    key={court.name}
                    type="button"
                    onClick={() => {
                      setSelectedCourtName(court.name);
                      setSelectedMatchId(null);
                    }}
                    className="group flex min-h-36 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-amber-500 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-700 transition group-hover:bg-amber-500 group-hover:text-slate-950 dark:text-amber-400">
                          <MapPin className="h-5 w-5" />
                        </div>
                        <div>
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-extrabold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {court.shortCode}
                          </span>
                          <h3 className="mt-1 font-display text-xl font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                            {court.name}
                          </h3>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-amber-500" />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs font-bold dark:border-slate-800">
                      {liveCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-red-600 dark:text-red-400">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                          {liveCount} LIVE
                        </span>
                      )}
                      <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-amber-800 dark:text-amber-300">
                        {scheduledCount} Siap Main
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {finishedCount} Selesai
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* STEP 2: PILIH JADWAL AKTIF DI LAPANGAN TERPILIH */}
      {currentStep === 2 && (
        <div className="animate-page-enter space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSelectedCourtName(null)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:border-amber-500 sm:min-h-9 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Ganti Lapangan
              </button>
              <div>
                <h2 className="font-display text-lg font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                  Jadwal Aktif • {selectedCourtName}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Klik salah satu pertandingan di bawah untuk membuka tombol skor.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['active', 'Aktif & Akan Main'],
                  ['finished', 'Sudah Selesai'],
                  ['all', 'Semua'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScheduleFilter(key)}
                  className={`min-h-11 rounded-full px-3.5 py-1.5 text-xs font-bold transition sm:min-h-8 ${
                    scheduleFilter === key
                      ? 'bg-amber-500 text-slate-950'
                      : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-amber-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {courtMatches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              Belum ada pertandingan siap dimainkan pada filter ini di{' '}
              <strong>{selectedCourtName}</strong>. Pastikan kedua tim sudah masuk bagan
              atau cek filter <em>Sudah Selesai</em>.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {courtMatches.map((m) => {
                const mA = m.teamAId ? teamMap.get(m.teamAId) : null;
                const mB = m.teamBId ? teamMap.get(m.teamBId) : null;
                const cat = tournamentMap.get(m.tournamentId);
                const mainRounds = data.matches
                  .filter(
                    (x) =>
                      x.tournamentId === m.tournamentId && x.bracketType === 'main'
                  )
                  .map((x) => x.round);
                const tr = mainRounds.length > 0 ? Math.max(...mainRounds) : 3;
                const stageLbl = formatInternationalStageLabel(m, tr);
                const curSet = m.sets.find((s) => s.setNumber === m.currentSet);

                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMatchId(m.id)}
                    className={`group flex flex-col justify-between gap-3 rounded-2xl border bg-white p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-amber-500 hover:shadow-md dark:bg-slate-900 ${
                      m.status === 'live'
                        ? 'border-red-500/60 ring-1 ring-red-500/20'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        {cat?.name} • {stageLbl}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${
                          m.status === 'live'
                            ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                            : m.status === 'finished'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {m.status === 'live'
                          ? `LIVE • SET ${m.currentSet}`
                          : m.status === 'finished'
                            ? `SELESAI (${m.setsWonA}-${m.setsWonB})`
                            : 'SIAP MAIN'}
                      </span>
                    </div>

                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <TeamAvatar team={mA} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-extrabold text-slate-900 dark:text-white">
                            {mA?.name || 'TBD'}
                          </p>
                          {mA?.school && (
                            <p className="truncate text-[11px] text-slate-500">
                              {mA.school}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl bg-slate-100 px-3 py-1.5 text-center font-display text-base font-extrabold tabular-nums text-slate-900 dark:bg-slate-950 dark:text-amber-400">
                        {m.status === 'live' && curSet
                          ? `${curSet.scoreA} : ${curSet.scoreB}`
                          : m.status === 'finished'
                            ? `${m.setsWonA} : ${m.setsWonB}`
                            : 'VS'}
                      </div>

                      <div className="flex min-w-0 items-center justify-end gap-2.5 text-right">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-extrabold text-slate-900 dark:text-white">
                            {mB?.name || 'TBD'}
                          </p>
                          {mB?.school && (
                            <p className="truncate text-[11px] text-slate-500">
                              {mB.school}
                            </p>
                          )}
                        </div>
                        <TeamAvatar team={mB} size="sm" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500 dark:border-slate-800">
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <CalendarClock className="h-3.5 w-3.5 text-amber-500" />
                        {m.scheduledAt || 'Jadwal belum diisi'}
                      </span>
                      <span className="inline-flex items-center gap-1 font-bold text-amber-700 group-hover:underline dark:text-amber-400">
                        {m.status === 'finished'
                          ? 'Lihat / Edit Skor'
                          : 'Buka Konsol Skor'}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* STEP 3: KONSOL SKOR LIVE */}
      {currentStep === 3 && activeMatch && (
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
                title="Reset skor & status permainan (menarik kembali kelulusan di bagan jika sudah lolos)"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-red-500/40 hover:text-red-500 dark:border-slate-700 dark:text-slate-400"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Permainan
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

          {/* Switch-Sides Reminder Banner (New Set / Deciding Set 8-pt) */}
          {switchReminder && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3.5 py-2.5 text-xs">
              <span className="font-bold text-sky-900 dark:text-sky-200">
                {switchReminder}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSwappedSides}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-sky-500"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  Tukar Posisi Sekarang
                </button>
                <button
                  type="button"
                  onClick={() => setSwitchReminder(null)}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Abaikan
                </button>
              </div>
            </div>
          )}

          {/* Local Court-Switch Control Bar */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSwappedSides}
                className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                  swappedSides
                    ? 'border-sky-500 bg-sky-500/15 text-sky-800 dark:text-sky-300'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <ArrowLeftRight
                  className={`h-3.5 w-3.5 text-sky-600 transition-transform duration-300 dark:text-sky-400 ${
                    swappedSides ? 'rotate-180' : ''
                  }`}
                />
                <span>Tukar Posisi (Kiri ↔ Kanan)</span>
                <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  {swappedSides
                    ? `${teamB?.shortCode || 'B'} ↔ ${teamA?.shortCode || 'A'}`
                    : `${teamA?.shortCode || 'A'} ↔ ${teamB?.shortCode || 'B'}`}
                </span>
              </button>
              {swappedSides && (
                <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                  Posisi Ditukar (Khusus Layar Juri)
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={toggleCompactTwoColMobile}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition md:hidden ${
                compactTwoColMobile
                  ? 'border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                  : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              {compactTwoColMobile ? 'Mode 2 Kolom: ON' : '2 Kolom HP'}
            </button>
          </div>

          {/* Scoreboard Control Grid */}
          <div
            className={
              compactTwoColMobile
                ? 'grid grid-cols-2 gap-2.5 md:gap-4'
                : 'grid gap-4 md:grid-cols-2'
            }
          >
            {(swappedSides ? (['B', 'A'] as const) : (['A', 'B'] as const)).map(
              (side, visualIdx) => {
                const team = side === 'A' ? teamA : teamB;
                const setsWon = side === 'A' ? activeMatch.setsWonA : activeMatch.setsWonB;
                const currentPts =
                  side === 'A' ? (activeSet?.scoreA ?? 0) : (activeSet?.scoreB ?? 0);
                const isServing = activeMatch.servingTeam === side;
                const isVisualLeft = visualIdx === 0;

                return (
                  <div
                    key={side}
                    ref={(el) => {
                      cardRefs.current[side] = el;
                    }}
                    className={`flex flex-col justify-between rounded-2xl border transition ${
                      compactTwoColMobile ? 'p-2.5 sm:p-4' : 'p-4'
                    } ${
                      isServing
                        ? 'border-amber-500/70 bg-amber-500/5 dark:bg-amber-500/10'
                        : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                          isVisualLeft
                            ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                            : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                        }`}
                      >
                        {isVisualLeft ? 'Lap. Kiri' : 'Lap. Kanan'}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Tim {side}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 sm:gap-3">
                      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                        <TeamAvatar team={team} size="md" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900 dark:text-white sm:text-base">
                            {team?.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Set Dimenangkan:{' '}
                            <strong className="text-amber-500">{setsWon}</strong>
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={busy || activeMatch.status === 'finished'}
                        onClick={() => runAction('serve', { team: side })}
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold transition sm:px-3 ${
                          isServing
                            ? 'bg-amber-500 text-slate-950 shadow-sm'
                            : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          <VolleyballIcon className="h-3.5 w-3.5" />
                          <span className={compactTwoColMobile ? 'hidden sm:inline' : ''}>
                            {isServing ? 'Servis' : 'Set Servis'}
                          </span>
                        </span>
                      </button>
                    </div>

                    {/* Big Score Display */}
                    <div
                      className={`my-4 text-center font-display font-extrabold leading-none tabular-nums text-slate-900 dark:text-white sm:my-5 ${
                        compactTwoColMobile ? 'text-5xl sm:text-7xl' : 'text-7xl'
                      }`}
                    >
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
                                <ArrowLeftRight
                  className={`h-3.5 w-3.5 text-sky-600 transition-transform duration-300 dark:text-sky-400 ${
                    swappedSides ? 'rotate-180' : ''
                  }`}
                />
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
                Pertandingan selesai ({activeMatch.setsWonA} - {activeMatch.setsWonB}). Laga telah diputuskan.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmModal({ type: 'reset' })}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-xs font-bold text-red-600 hover:bg-red-500/20 dark:text-red-400"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset Permainan
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmModal({ type: 'extra_set' })}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-bold text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
                >
                  <Plus className="h-3.5 w-3.5" />
                  +1 Set Tambahan
                </button>
              </div>
            </div>
          )}
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
                className={
                  setDecisionPrompt.willWinMatch
                    ? 'w-full rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
                    : 'w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-600 hover:bg-amber-500/20 dark:text-amber-400'
                }
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
                ? 'Reset Skor & Status Permainan?'
                : confirmModal.type === 'extra_set'
                  ? 'Buka Set Tambahan (0-0)?'
                  : 'Selesaikan Pertandingan?'}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {confirmModal.type === 'reset'
                ? 'Semua poin, set, dan status pertandingan ini akan dikembalikan ke kondisi awal (belum dimulai). Jika tim telah lolos ke babak berikutnya (seperti Quarter Final), kelulusannya akan otomatis ditarik kembali dari bagan.'
                : confirmModal.type === 'extra_set'
                  ? 'Pertandingan yang sudah selesai akan dibuka kembali menjadi LIVE dengan set baru 0-0, dan kelulusan pemenang di bagan berikutnya akan ditarik sementara sampai set tambahan diselesaikan.'
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
                    : confirmModal.type === 'extra_set'
                      ? runAction('extra_set')
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

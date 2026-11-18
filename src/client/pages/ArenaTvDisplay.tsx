import {
  ArrowLeft,
  ArrowLeftRight,
  Columns2,
  Lock,
  Maximize,
  Minimize,
  Monitor,
  Radio,
  RefreshCw,
  Timer,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PartnersFooter } from '../components/PartnersFooter';
import { TeamAvatar } from '../components/TeamAvatar';
import { VolleyballIcon } from '../components/VolleyballIcon';
import { apiFetch } from '../lib/api';
import { syncDocumentBranding } from '../lib/seo';
import type { Match, OverviewData, Team, Tournament } from '../types';

type TvDisplayMode = 'single' | 'split' | 'rotate';

function getInitialTvMode(): TvDisplayMode {
  if (typeof window === 'undefined') return 'single';
  const saved = localStorage.getItem('ov_tv_mode');
  if (saved === 'split' || saved === 'rotate') return saved;
  return 'single';
}

function TvCounterBadgeRow({
  timeoutsUsed,
  subsUsed,
  align = 'left',
}: {
  timeoutsUsed: number;
  subsUsed: number;
  align?: 'left' | 'right';
}) {
  return (
    <div
      className={`mt-3 flex flex-wrap items-center gap-2.5 text-xs font-bold ${
        align === 'right' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/80 bg-slate-950/80 px-3 py-1 text-slate-300">
        <Timer className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-[11px] uppercase tracking-wider text-slate-400">T/O</span>
        <span className="flex items-center gap-1">
          {[0, 1].map((dotIdx) => (
            <span
              key={dotIdx}
              className={`h-2.5 w-2.5 rounded-full ${
                dotIdx < timeoutsUsed
                  ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.65)]'
                  : 'bg-slate-700'
              }`}
            />
          ))}
        </span>
      </div>

      <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/80 bg-slate-950/80 px-3 py-1 text-slate-300">
        <ArrowLeftRight className="h-3.5 w-3.5 text-sky-400" />
        <span className="text-[11px] uppercase tracking-wider text-slate-400">SUB</span>
        <span className="tabular-nums text-sky-300">{subsUsed}/6</span>
      </div>
    </div>
  );
}

function SplitCourtPanel({
  match,
  teamMap,
  tournamentMap,
}: {
  match: Match;
  teamMap: Map<number, Team>;
  tournamentMap: Map<number, Tournament>;
}) {
  const teamA = match.teamAId ? teamMap.get(match.teamAId) : null;
  const teamB = match.teamBId ? teamMap.get(match.teamBId) : null;
  const category = tournamentMap.get(match.tournamentId);
  const activeSet = match.sets.find((s) => s.setNumber === match.currentSet);
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';

  return (
    <div className="flex flex-col justify-between overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl">
      {/* Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="sport-skew inline-block rounded bg-amber-500 px-3 py-0.5 text-xs font-extrabold uppercase tracking-wider text-slate-950">
            <span className="sport-unskew">{match.courtName}</span>
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
            {category?.name || 'SVC'}
          </span>
        </div>

        {isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-0.5 text-xs font-extrabold uppercase text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            LIVE • SET {match.currentSet}
          </span>
        ) : isFinished ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-0.5 text-xs font-extrabold uppercase text-amber-400">
            <Trophy className="h-3.5 w-3.5" /> SELESAI
          </span>
        ) : (
          <span className="rounded-full bg-slate-800 px-3 py-0.5 text-xs font-semibold text-slate-400">
            {match.scheduledAt || 'Segera'}
          </span>
        )}
      </div>

      {/* Teams & Giant Scores */}
      <div className="my-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* Side A */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <TeamAvatar team={teamA} size="lg" />
            {isLive && match.servingTeam === 'A' && (
              <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow">
                <VolleyballIcon className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
          <h3 className="mt-2.5 line-clamp-2 font-display text-xl font-extrabold uppercase tracking-wide text-white xl:text-2xl">
            {teamA?.name || 'TIM A'}
          </h3>
          <p className="line-clamp-1 text-xs text-slate-400">
            {teamA?.school || teamA?.shortCode}
          </p>
          {isLive && activeSet && (
            <TvCounterBadgeRow
              timeoutsUsed={activeSet.timeoutsA ?? 0}
              subsUsed={activeSet.subsA ?? 0}
            />
          )}
        </div>

        {/* Center Score */}
        <div className="flex flex-col items-center px-2">
          <div className="flex items-center gap-2 font-display text-6xl font-extrabold tabular-nums xl:text-7xl">
            <span
              className={
                isLive && match.servingTeam === 'A' ? 'text-amber-400' : 'text-white'
              }
            >
              {isLive && activeSet ? activeSet.scoreA : match.setsWonA}
            </span>
            <span className="text-3xl text-slate-600">:</span>
            <span
              className={
                isLive && match.servingTeam === 'B' ? 'text-amber-400' : 'text-white'
              }
            >
              {isLive && activeSet ? activeSet.scoreB : match.setsWonB}
            </span>
          </div>

          <div className="mt-2 rounded-full bg-slate-950 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-amber-400 ring-1 ring-slate-800">
            SET {match.setsWonA} - {match.setsWonB}
          </div>
        </div>

        {/* Side B */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <TeamAvatar team={teamB} size="lg" />
            {isLive && match.servingTeam === 'B' && (
              <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow">
                <VolleyballIcon className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
          <h3 className="mt-2.5 line-clamp-2 font-display text-xl font-extrabold uppercase tracking-wide text-white xl:text-2xl">
            {teamB?.name || 'TIM B'}
          </h3>
          <p className="line-clamp-1 text-xs text-slate-400">
            {teamB?.school || teamB?.shortCode}
          </p>
          {isLive && activeSet && (
            <TvCounterBadgeRow
              timeoutsUsed={activeSet.timeoutsB ?? 0}
              subsUsed={activeSet.subsB ?? 0}
            />
          )}
        </div>
      </div>

      {/* Bottom Set Pills */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-800 pt-3">
        {match.sets.length === 0 ? (
          <span className="text-xs text-slate-500">Menunggu set dimulai</span>
        ) : (
          match.sets.map((s) => (
            <span
              key={s.id}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold tabular-nums ${
                s.setNumber === match.currentSet && isLive
                  ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                  : 'bg-slate-950 text-slate-300'
              }`}
            >
              S{s.setNumber}: {s.scoreA}-{s.scoreB}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export function ArenaTvDisplay() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);
  const [tvMode, setTvModeState] = useState<TvDisplayMode>(getInitialTvMode);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const param = new URLSearchParams(window.location.search).get('match');
    return param ? Number(param) : null;
  });
  const [secondaryMatchId, setSecondaryMatchId] = useState<number | null>(null);
  const [rotateIndex, setRotateIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsIdle, setControlsIdle] = useState(false);
  const [connected, setConnected] = useState(false);

  const setTvMode = (next: TvDisplayMode) => {
    setTvModeState(next);
    localStorage.setItem('ov_tv_mode', next);
  };

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/public/overview', { cache: 'no-store' }).then((r) =>
        r.json()
      );
      const ov = res as OverviewData;
      setData(ov);
      setSelectedMatchId((prev) => {
        const list = ov.matches ?? [];
        if (prev && list.some((m) => m.id === prev)) return prev;
        const firstLive = list.find((m) => m.status === 'live');
        if (firstLive) return firstLive.id;
        const firstPlayable = list.find(
          (m) => m.status !== 'bye' && (m.teamAId || m.teamBId)
        );
        return firstPlayable?.id ?? null;
      });
    } catch {
      // ignore transient network glitches on TV display
    }
  }, []);

  useEffect(() => {
    syncDocumentBranding(data?.settings, 'Layar TV Arena');
  }, [data?.settings]);

  useEffect(() => {
    apiFetch<{ unlocked: boolean }>('/api/public/tv-check')
      .then((res) => setUnlocked(res.unlocked))
      .catch(() => setUnlocked(false));
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!unlocked) return;
    loadOverview();

    let fallbackEs: EventSource | null = null;
    const bindEvents = (source: EventSource) => {
      source.addEventListener('connected', () => setConnected(true));
      for (const ev of [
        'match_updated',
        'bracket_updated',
        'tournament_updated',
        'settings_updated',
      ]) {
        source.addEventListener(ev, () => loadOverview());
      }
    };

    const es = new EventSource('/api/public/tv-stream');
    bindEvents(es);
    es.onerror = () => {
      es.close();
      if (!fallbackEs) {
        fallbackEs = new EventSource('/api/public/stream');
        bindEvents(fallbackEs);
        fallbackEs.onerror = () => setConnected(false);
      }
    };

    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);

    return () => {
      es.close();
      fallbackEs?.close();
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [unlocked, loadOverview]);

  // Auto-hide header controls when idle for 4.5s in fullscreen
  useEffect(() => {
    if (!isFullscreen) {
      setControlsIdle(false);
      return;
    }
    let idleTimer = window.setTimeout(() => setControlsIdle(true), 4500);
    const wake = () => {
      setControlsIdle(false);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setControlsIdle(true), 4500);
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      window.clearTimeout(idleTimer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, [isFullscreen]);

  const playableMatches = (data?.matches ?? []).filter(
    (m) => m.status !== 'bye' && (m.teamAId || m.teamBId)
  );
  const liveMatches = playableMatches.filter((m) => m.status === 'live');
  const rotationPool = liveMatches.length > 0 ? liveMatches : playableMatches;

  // 12-second Auto-Rotate timer
  useEffect(() => {
    if (tvMode !== 'rotate' || rotationPool.length <= 1) return;
    const timer = window.setInterval(() => {
      setRotateIndex((prev) => (prev + 1) % rotationPool.length);
    }, 12000);
    return () => window.clearInterval(timer);
  }, [tvMode, rotationPool.length]);

  const handleUnlockPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    try {
      await apiFetch('/api/public/tv-auth', {
        method: 'POST',
        body: JSON.stringify({ pin: pinInput }),
      });
      setUnlocked(true);
    } catch (err) {
      setPinError((err as Error).message);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const primaryMatch: Match | undefined =
    tvMode === 'rotate'
      ? rotationPool[rotateIndex % Math.max(1, rotationPool.length)]
      : playableMatches.find((m) => m.id === selectedMatchId) ?? playableMatches[0];

  const secondMatchCandidate: Match | undefined =
    playableMatches.find(
      (m) => m.id === secondaryMatchId && m.id !== primaryMatch?.id
    ) ??
    liveMatches.find((m) => m.id !== primaryMatch?.id) ??
    playableMatches.find((m) => m.id !== primaryMatch?.id);

  const teamMap = new Map<number, Team>((data?.teams ?? []).map((t) => [t.id, t]));
  const tournamentMap = new Map<number, Tournament>(
    (data?.tournaments ?? []).map((t) => [t.id, t])
  );

  const teamA = primaryMatch?.teamAId ? teamMap.get(primaryMatch.teamAId) : null;
  const teamB = primaryMatch?.teamBId ? teamMap.get(primaryMatch.teamBId) : null;
  const category = primaryMatch ? tournamentMap.get(primaryMatch.tournamentId) : null;
  const activeSet = primaryMatch?.sets.find(
    (s) => s.setNumber === primaryMatch.currentSet
  );
  const isLive = primaryMatch?.status === 'live';
  const isFinished = primaryMatch?.status === 'finished';

  if (unlocked === false) {
    return (
      <div className="dark flex min-h-screen flex-col items-center justify-center bg-[#070A12] p-4 text-white">
        <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900/95 p-6 text-center shadow-2xl">
          <img
            src={data?.settings?.logoUrl || '/brand/svc-crest-color.svg'}
            alt="SVC"
            className="mx-auto h-16 w-16 object-contain"
          />
          <div className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-amber-400">
            <Lock className="h-3.5 w-3.5" />
            Jalur Prioritas VIP SSE
          </div>
          <h1 className="mt-2 font-display text-2xl font-extrabold uppercase tracking-wide">
            Layar Skor TV Arena
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Masukkan PIN Layar TV dari menu Panitia / Admin untuk mengaktifkan tampilan real-time prioritas.
          </p>

          {pinError && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-400">
              {pinError}
            </div>
          )}

          <form onSubmit={handleUnlockPin} className="mt-4 space-y-3">
            <input
              type="password"
              required
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="Masukkan PIN TV"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-center font-display text-2xl font-extrabold tracking-widest text-amber-400 focus:border-amber-400 focus-visible:outline-2 focus-visible:outline-amber-400"
            />
            <button
              type="submit"
              className="min-h-11 w-full rounded-xl bg-amber-500 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-950 shadow-lg shadow-amber-500/20 hover:bg-amber-400"
            >
              Buka Layar TV
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="dark relative flex min-h-screen flex-col justify-between overflow-hidden bg-[#070A12] text-white selection:bg-amber-500/30">
      <img
        src="/brand/svc-net-official.svg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -left-1 top-[64px] h-80 w-80 object-contain object-left-top opacity-20"
      />
      <img
        src="/brand/svc-spiker-official.svg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute bottom-14 right-6 h-[420px] w-[320px] object-contain opacity-15"
      />

      {/* Top TV Broadcast Header */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-950 px-6 py-3.5">
        <div className="flex items-center gap-3.5">
          <img
            src={data?.settings?.logoUrl || '/brand/svc-crest-color.svg'}
            alt="SVC"
            className="h-11 w-11 object-contain"
          />
          <div>
            <h1 className="font-display text-xl font-extrabold uppercase tracking-wider text-white sm:text-2xl">
              {data?.settings?.eventName || 'Smansage Volleyball Competition'}
            </h1>
            <p className="text-xs font-semibold text-amber-400">
              {tvMode === 'split'
                ? 'Mode Multi-Lapangan (Split 2 Layar)'
                : tvMode === 'rotate'
                  ? `Auto-Rotate (${(rotateIndex % Math.max(1, rotationPool.length)) + 1}/${Math.max(1, rotationPool.length)}) • ${primaryMatch?.courtName || 'Arena'}`
                  : `${category?.name || 'SVC'} • ${primaryMatch?.courtName || 'Arena Utama'}`}
            </p>
          </div>
        </div>

        <div
          className={`flex flex-wrap items-center gap-2 transition-opacity duration-300 ${
            controlsIdle ? 'opacity-20 hover:opacity-100' : 'opacity-100'
          }`}
        >
          {/* Multi-Court Display Mode Switcher */}
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-900 p-1">
            <button
              type="button"
              onClick={() => setTvMode('single')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                tvMode === 'single'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              <span className="hidden md:inline">1 Lapangan</span>
            </button>
            <button
              type="button"
              onClick={() => setTvMode('split')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                tvMode === 'split'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Split 2</span>
            </button>
            <button
              type="button"
              onClick={() => setTvMode('rotate')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                tvMode === 'rotate'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Auto 12d</span>
            </button>
          </div>

          {tvMode !== 'rotate' && (
            <select
              value={primaryMatch?.id ?? ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSelectedMatchId(id);
                window.history.replaceState(null, '', `/tv?match=${id}`);
              }}
              aria-label="Pilih Pertandingan Layar TV"
              className="min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 focus:border-amber-400"
            >
              {playableMatches.map((m) => {
                const tA = m.teamAId ? teamMap.get(m.teamAId)?.shortCode : 'TBD';
                const tB = m.teamBId ? teamMap.get(m.teamBId)?.shortCode : 'TBD';
                const statusTag =
                  m.status === 'live'
                    ? 'LIVE'
                    : m.status === 'finished'
                      ? 'SELESAI'
                      : 'JADWAL';
                return (
                  <option key={m.id} value={m.id}>
                    [{statusTag}] {m.courtName}: {tA} vs {tB}
                  </option>
                );
              })}
            </select>
          )}

          {tvMode === 'split' && playableMatches.length > 1 && (
            <select
              value={secondMatchCandidate?.id ?? ''}
              onChange={(e) => setSecondaryMatchId(Number(e.target.value))}
              aria-label="Pilih Pertandingan Kedua Layar TV"
              className="min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 focus:border-amber-400"
            >
              {playableMatches
                .filter((m) => m.id !== primaryMatch?.id)
                .map((m) => {
                  const tA = m.teamAId ? teamMap.get(m.teamAId)?.shortCode : 'TBD';
                  const tB = m.teamBId ? teamMap.get(m.teamBId)?.shortCode : 'TBD';
                  return (
                    <option key={m.id} value={m.id}>
                      Layar 2 • {m.courtName}: {tA} vs {tB}
                    </option>
                  );
                })}
            </select>
          )}

          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-400">
            <Radio className="h-3.5 w-3.5" />
            {connected ? 'VIP SSE' : 'SYNC'}
          </span>

          <button
            type="button"
            onClick={toggleFullscreen}
            title="Layar Penuh"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-amber-400 transition hover:border-amber-500"
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {isFullscreen ? 'Keluar' : 'Penuh'}
            </span>
          </button>

          {!isFullscreen && (
            <a
              href="/"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Portal
            </a>
          )}
        </div>
      </header>

      {/* Main Giant Arena Scoreboard */}
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 py-6 sm:px-8">
        {!primaryMatch ? (
          <div className="text-center text-slate-400">
            Menunggu jadwal pertandingan aktif...
          </div>
        ) : tvMode === 'split' && secondMatchCandidate ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <SplitCourtPanel
              match={primaryMatch}
              teamMap={teamMap}
              tournamentMap={tournamentMap}
            />
            <SplitCourtPanel
              match={secondMatchCandidate}
              teamMap={teamMap}
              tournamentMap={tournamentMap}
            />
          </div>
        ) : (
          <div key={primaryMatch.id} className="animate-page-enter space-y-6">
            {/* Top Match Status Ribbon */}
            <div className="flex items-center justify-center gap-3">
              <span className="sport-skew inline-block rounded bg-amber-500 px-4 py-1 text-sm font-extrabold uppercase tracking-wider text-slate-950 shadow-lg shadow-amber-500/20">
                <span className="sport-unskew">{primaryMatch.courtName}</span>
              </span>
              {isLive ? (
                <span className="sport-skew inline-flex items-center gap-2 rounded bg-red-600 px-4 py-1 text-sm font-extrabold uppercase tracking-wider text-white shadow-lg shadow-red-600/30">
                  <span className="sport-unskew inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                    LIVE • SET {primaryMatch.currentSet}
                  </span>
                </span>
              ) : isFinished ? (
                <span className="sport-skew inline-flex items-center gap-1.5 rounded bg-slate-800 px-4 py-1 text-sm font-extrabold uppercase tracking-wider text-amber-400 ring-1 ring-amber-500/40">
                  <span className="sport-unskew inline-flex items-center gap-1.5">
                    <Trophy className="h-4 w-4" /> PERTANDINGAN SELESAI
                  </span>
                </span>
              ) : (
                <span className="rounded-full bg-slate-800 px-4 py-1 text-sm font-bold text-slate-300">
                  {primaryMatch.scheduledAt || 'Segera Bertanding'}
                </span>
              )}
            </div>

            {/* 3-Column Giant Scoreboard */}
            <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_220px_1fr]">
              {/* TEAM A PANEL */}
              <div
                className={`relative flex flex-col justify-between overflow-hidden rounded-3xl border bg-slate-900/90 p-6 shadow-2xl transition-all sm:p-8 ${
                  primaryMatch.servingTeam === 'A' && isLive
                    ? 'border-amber-400 ring-2 ring-amber-400/40'
                    : 'border-slate-800'
                }`}
              >
                <div
                  className="absolute inset-y-0 left-0 w-2.5"
                  style={{ backgroundColor: teamA?.color || '#E09D17' }}
                />

                <div className="flex items-center justify-between gap-4 pl-2">
                  <div className="flex min-w-0 items-center gap-4">
                    <TeamAvatar team={teamA} size="lg" />
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-2xl font-extrabold uppercase tracking-wide sm:text-4xl">
                        {teamA?.name || 'TIM A'}
                      </h2>
                      <p className="truncate text-sm font-semibold text-slate-400">
                        {teamA?.school || teamA?.shortCode}
                      </p>
                    </div>
                  </div>
                  {isLive && primaryMatch.servingTeam === 'A' && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-extrabold uppercase text-slate-950 shadow-lg shadow-amber-400/30">
                      <VolleyballIcon className="h-4 w-4 animate-bounce" />
                      SERVIS
                    </span>
                  )}
                </div>

                <div className="my-4 text-center font-display text-8xl font-extrabold leading-none tabular-nums tracking-tight sm:text-[9.5rem] xl:text-[11.5rem]">
                  <span
                    className={
                      primaryMatch.servingTeam === 'A' && isLive
                        ? 'text-amber-400 drop-shadow-[0_0_25px_rgba(245,197,56,0.25)]'
                        : 'text-white'
                    }
                  >
                    {isLive && activeSet ? activeSet.scoreA : primaryMatch.setsWonA}
                  </span>
                </div>

                {isLive && activeSet && (
                  <div className="pl-2">
                    <TvCounterBadgeRow
                      timeoutsUsed={activeSet.timeoutsA ?? 0}
                      subsUsed={activeSet.subsA ?? 0}
                      align="left"
                    />
                  </div>
                )}
              </div>

              {/* CENTER SETS & HISTORY */}
              <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-slate-800 bg-slate-950/90 p-5 text-center">
                <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
                  SKOR SET
                </span>
                <div className="flex items-center gap-3 font-display text-6xl font-extrabold tabular-nums text-amber-400">
                  <span>{primaryMatch.setsWonA}</span>
                  <span className="text-3xl text-slate-600">-</span>
                  <span>{primaryMatch.setsWonB}</span>
                </div>

                {primaryMatch.sets.length > 0 && (
                  <div className="mt-2 w-full space-y-1.5 border-t border-slate-800 pt-3">
                    {primaryMatch.sets.map((s) => (
                      <div
                        key={s.id}
                        className={`flex items-center justify-between rounded-lg px-3 py-1 text-xs font-bold tabular-nums ${
                          s.setNumber === primaryMatch.currentSet && isLive
                            ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                            : 'bg-slate-900 text-slate-300'
                        }`}
                      >
                        <span className="text-slate-500">SET {s.setNumber}</span>
                        <span>
                          {s.scoreA} - {s.scoreB}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* TEAM B PANEL */}
              <div
                className={`relative flex flex-col justify-between overflow-hidden rounded-3xl border bg-slate-900/90 p-6 shadow-2xl transition-all sm:p-8 ${
                  primaryMatch.servingTeam === 'B' && isLive
                    ? 'border-amber-400 ring-2 ring-amber-400/40'
                    : 'border-slate-800'
                }`}
              >
                <div
                  className="absolute inset-y-0 right-0 w-2.5"
                  style={{ backgroundColor: teamB?.color || '#3B82F6' }}
                />

                <div className="flex items-center justify-between gap-4 pr-2">
                  <div className="flex min-w-0 items-center gap-4">
                    <TeamAvatar team={teamB} size="lg" />
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-2xl font-extrabold uppercase tracking-wide sm:text-4xl">
                        {teamB?.name || 'TIM B'}
                      </h2>
                      <p className="truncate text-sm font-semibold text-slate-400">
                        {teamB?.school || teamB?.shortCode}
                      </p>
                    </div>
                  </div>
                  {isLive && primaryMatch.servingTeam === 'B' && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-extrabold uppercase text-slate-950 shadow-lg shadow-amber-400/30">
                      <VolleyballIcon className="h-4 w-4 animate-bounce" />
                      SERVIS
                    </span>
                  )}
                </div>

                <div className="my-4 text-center font-display text-8xl font-extrabold leading-none tabular-nums tracking-tight sm:text-[9.5rem] xl:text-[11.5rem]">
                  <span
                    className={
                      primaryMatch.servingTeam === 'B' && isLive
                        ? 'text-amber-400 drop-shadow-[0_0_25px_rgba(245,197,56,0.25)]'
                        : 'text-white'
                    }
                  >
                    {isLive && activeSet ? activeSet.scoreB : primaryMatch.setsWonB}
                  </span>
                </div>

                {isLive && activeSet && (
                  <div className="pr-2">
                    <TvCounterBadgeRow
                      timeoutsUsed={activeSet.timeoutsB ?? 0}
                      subsUsed={activeSet.subsB ?? 0}
                      align="right"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Organizer & Sponsors Strip */}
      <PartnersFooter settings={data?.settings} compact />
    </div>
  );
}

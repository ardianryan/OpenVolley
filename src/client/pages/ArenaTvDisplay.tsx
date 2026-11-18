import { ArrowLeft, Lock, Maximize, Minimize, Radio, Trophy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PartnersFooter } from '../components/PartnersFooter';
import { TeamAvatar } from '../components/TeamAvatar';
import { VolleyballIcon } from '../components/VolleyballIcon';
import { apiFetch } from '../lib/api';
import type { Match, OverviewData, Team } from '../types';

export function ArenaTvDisplay() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const param = new URLSearchParams(window.location.search).get('match');
    return param ? Number(param) : null;
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connected, setConnected] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/public/overview', { cache: 'no-store' }).then((r) =>
        r.json()
      );
      setData(res as OverviewData);
      setSelectedMatchId((prev) => {
        const list = (res as OverviewData).matches ?? [];
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

  const playableMatches = (data?.matches ?? []).filter(
    (m) => m.status !== 'bye' && (m.teamAId || m.teamBId)
  );
  const match: Match | undefined =
    playableMatches.find((m) => m.id === selectedMatchId) ?? playableMatches[0];

  const teamMap = new Map<number, Team>((data?.teams ?? []).map((t) => [t.id, t]));
  const tournamentMap = new Map(
    (data?.tournaments ?? []).map((t) => [t.id, t])
  );

  const teamA = match?.teamAId ? teamMap.get(match.teamAId) : null;
  const teamB = match?.teamBId ? teamMap.get(match.teamBId) : null;
  const category = match ? tournamentMap.get(match.tournamentId) : null;
  const activeSet = match?.sets.find((s) => s.setNumber === match.currentSet);
  const isLive = match?.status === 'live';
  const isFinished = match?.status === 'finished';

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
      {/* Subtle Official SVC Arena Vector Watermarks (Flush top-left under header + full spiker & ball bottom-right) */}
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
              {category?.name || 'SVC'} • {match?.courtName || 'Arena Utama'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={match?.id ?? ''}
            onChange={(e) => {
              const id = Number(e.target.value);
              setSelectedMatchId(id);
              window.history.replaceState(null, '', `/tv?match=${id}`);
            }}
            aria-label="Pilih Pertandingan Layar TV"
            className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 focus:border-amber-400 focus-visible:outline-2 focus-visible:outline-amber-400"
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

          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-400">
            <Radio className="h-3.5 w-3.5" />
            {connected ? 'VIP PRIORITY SSE' : 'RECONNECTING'}
          </span>

          <button
            type="button"
            onClick={toggleFullscreen}
            title="Layar Penuh"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-amber-400 transition hover:border-amber-500"
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {isFullscreen ? 'Keluar Penuh' : 'Layar Penuh'}
            </span>
          </button>

          {!isFullscreen && (
            <a
              href="/"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Portal
            </a>
          )}
        </div>
      </header>

      {/* Main Giant Arena Scoreboard */}
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 py-6 sm:px-8">
        {!match ? (
          <div className="text-center text-slate-400">
            Menunggu jadwal pertandingan aktif...
          </div>
        ) : (
          <div className="space-y-6">
            {/* Top Match Status Ribbon */}
            <div className="flex items-center justify-center gap-3">
              <span className="sport-skew inline-block rounded bg-amber-500 px-4 py-1 text-sm font-extrabold uppercase tracking-wider text-slate-950 shadow-lg shadow-amber-500/20">
                <span className="sport-unskew">{match.courtName}</span>
              </span>
              {isLive ? (
                <span className="sport-skew inline-flex items-center gap-2 rounded bg-red-600 px-4 py-1 text-sm font-extrabold uppercase tracking-wider text-white shadow-lg shadow-red-600/30">
                  <span className="sport-unskew inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                    LIVE • SET {match.currentSet}
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
                  {match.scheduledAt || 'Segera Bertanding'}
                </span>
              )}
            </div>

            {/* 3-Column Giant Scoreboard */}
            <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_220px_1fr]">
              {/* TEAM A PANEL */}
              <div
                className={`relative flex flex-col justify-between overflow-hidden rounded-3xl border bg-slate-900/90 p-6 shadow-2xl transition-all sm:p-8 ${
                  match.servingTeam === 'A' && isLive
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
                  {isLive && match.servingTeam === 'A' && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-extrabold uppercase text-slate-950 shadow-lg shadow-amber-400/30">
                      <VolleyballIcon className="h-4 w-4 animate-bounce" />
                      SERVIS
                    </span>
                  )}
                </div>

                <div className="my-4 text-center font-display text-8xl font-extrabold leading-none tabular-nums tracking-tight sm:text-[9.5rem] xl:text-[11.5rem]">
                  <span
                    className={
                      match.servingTeam === 'A' && isLive
                        ? 'text-amber-400 drop-shadow-[0_0_25px_rgba(245,197,56,0.25)]'
                        : 'text-white'
                    }
                  >
                    {isLive && activeSet ? activeSet.scoreA : match.setsWonA}
                  </span>
                </div>
              </div>

              {/* CENTER SETS & HISTORY */}
              <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-slate-800 bg-slate-950/90 p-5 text-center">
                <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
                  SKOR SET
                </span>
                <div className="flex items-center gap-3 font-display text-6xl font-extrabold tabular-nums text-amber-400">
                  <span>{match.setsWonA}</span>
                  <span className="text-3xl text-slate-600">-</span>
                  <span>{match.setsWonB}</span>
                </div>

                {match.sets.length > 0 && (
                  <div className="mt-2 w-full space-y-1.5 border-t border-slate-800 pt-3">
                    {match.sets.map((s) => (
                      <div
                        key={s.id}
                        className={`flex items-center justify-between rounded-lg px-3 py-1 text-xs font-bold tabular-nums ${
                          s.setNumber === match.currentSet && isLive
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
                  match.servingTeam === 'B' && isLive
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
                  {isLive && match.servingTeam === 'B' && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-extrabold uppercase text-slate-950 shadow-lg shadow-amber-400/30">
                      <VolleyballIcon className="h-4 w-4 animate-bounce" />
                      SERVIS
                    </span>
                  )}
                </div>

                <div className="my-4 text-center font-display text-8xl font-extrabold leading-none tabular-nums tracking-tight sm:text-[9.5rem] xl:text-[11.5rem]">
                  <span
                    className={
                      match.servingTeam === 'B' && isLive
                        ? 'text-amber-400 drop-shadow-[0_0_25px_rgba(245,197,56,0.25)]'
                        : 'text-white'
                    }
                  >
                    {isLive && activeSet ? activeSet.scoreB : match.setsWonB}
                  </span>
                </div>
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

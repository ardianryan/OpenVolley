import {
  ArrowLeft,
  ArrowLeftRight,
  Clock,
  Lock,
  Maximize,
  Minimize,
  Radio,
  Timer,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isPlaceholderDrawSlotName } from '../../shared/fivb-draw';
import { BracketView } from '../components/BracketView';
import { PartnersFooter } from '../components/PartnersFooter';
import { PoolStandingsView } from '../components/PoolStandingsView';
import { TeamAvatar } from '../components/TeamAvatar';
import { VolleyballIcon } from '../components/VolleyballIcon';
import { apiFetch } from '../lib/api';
import { syncDocumentBranding } from '../lib/seo';
import type {
  DrawSlotBroadcastPayload,
  Match,
  OverviewData,
  Team,
  Tournament,
  TvScreen,
  TvScreenMode,
} from '../types';

type TvDisplayMode = 'single' | 'split' | 'rotate' | 'bracket' | 'standby';

function mapScreenModeToDisplay(mode: TvScreenMode): TvDisplayMode {
  return mode === 'auto_rotate' ? 'rotate' : mode;
}

function getInitialTvMode(): TvDisplayMode {
  if (typeof window === 'undefined') return 'single';
  const paramMode = new URLSearchParams(window.location.search).get('mode');
  if (
    paramMode === 'split' ||
    paramMode === 'rotate' ||
    paramMode === 'bracket' ||
    paramMode === 'standby'
  ) {
    return paramMode;
  }
  const saved = localStorage.getItem('ov_tv_mode');
  if (
    saved === 'split' ||
    saved === 'rotate' ||
    saved === 'bracket' ||
    saved === 'standby'
  ) {
    return saved;
  }
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
  const lastSet =
    [...match.sets].reverse().find((s) => s.isFinished || s.scoreA > 0 || s.scoreB > 0) ??
    (match.sets.length > 0 ? match.sets[match.sets.length - 1] : undefined);
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const isWinnerA = Boolean(isFinished && match.winnerId && match.winnerId === match.teamAId);
  const isWinnerB = Boolean(isFinished && match.winnerId && match.winnerId === match.teamBId);

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
                (isLive && match.servingTeam === 'A') || isWinnerA
                  ? 'text-amber-400'
                  : 'text-white'
              }
            >
              {isLive && activeSet ? activeSet.scoreA : match.setsWonA}
            </span>
            <span className="text-3xl text-slate-600">:</span>
            <span
              className={
                (isLive && match.servingTeam === 'B') || isWinnerB
                  ? 'text-amber-400'
                  : 'text-white'
              }
            >
              {isLive && activeSet ? activeSet.scoreB : match.setsWonB}
            </span>
          </div>

          <div className="mt-2 rounded-full bg-slate-950 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-amber-400 ring-1 ring-slate-800">
            {isFinished && lastSet
              ? `SET TERAKHIR (S${lastSet.setNumber}): ${lastSet.scoreA}-${lastSet.scoreB}`
              : `SET ${match.setsWonA} - ${match.setsWonB}`}
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
          match.sets.map((s) => {
            const isCurrentOrFinalSet =
              (isLive && s.setNumber === match.currentSet) ||
              (isFinished && lastSet && s.setNumber === lastSet.setNumber);
            return (
              <span
                key={s.id}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold tabular-nums ${
                  isCurrentOrFinalSet
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                    : 'bg-slate-950 text-slate-300'
                }`}
              >
                S{s.setNumber}: {s.scoreA}-{s.scoreB}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ArenaTvDisplay() {
  const [screenSlug, setScreenSlug] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('screen');
    return raw ? raw.trim().toLowerCase() : null;
  });
  const [hasExplicitMatchParam] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(new URLSearchParams(window.location.search).get('match'));
  });
  const [activeScreen, setActiveScreen] = useState<TvScreen | null>(null);
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [vipAuthorized, setVipAuthorized] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);
  const [tvMode, setTvModeState] = useState<TvDisplayMode>(getInitialTvMode);
  const [nowClock, setNowClock] = useState<Date>(() => new Date());
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const param = new URLSearchParams(window.location.search).get('match');
    return param ? Number(param) : null;
  });
  const [secondaryMatchId, setSecondaryMatchId] = useState<number | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [recentDrawEvent, setRecentDrawEvent] =
    useState<DrawSlotBroadcastPayload | null>(null);
  const [rotateIndex, setRotateIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsIdle, setControlsIdle] = useState(false);
  const [connected, setConnected] = useState(false);
  const latestVersionRef = useRef<number>(0);
  const fetchSeqRef = useRef<number>(0);

  const applyRemoteScreenConfig = useCallback(
    (scr: TvScreen, allMatches?: Match[], allCourts?: OverviewData['masterCourts']) => {
      setActiveScreen(scr);
      setTvModeState(mapScreenModeToDisplay(scr.mode));
      if (scr.targetMatchId) {
        setSelectedMatchId(scr.targetMatchId);
      } else if (scr.courtId && allMatches && allCourts) {
        const boundCourt = allCourts.find((c) => c.id === scr.courtId);
        if (boundCourt) {
          const courtLive =
            allMatches.find(
              (m) => m.status === 'live' && m.courtName === boundCourt.name
            ) ??
            allMatches.find(
              (m) =>
                m.status !== 'bye' &&
                (m.teamAId || m.teamBId) &&
                m.courtName === boundCourt.name
            );
          if (courtLive) setSelectedMatchId(courtLive.id);
        }
      }
      if (scr.secondaryMatchId) {
        setSecondaryMatchId(scr.secondaryMatchId);
      }
      if (scr.bracketTournamentId) {
        setSelectedTournamentId(scr.bracketTournamentId);
      }
    },
    []
  );

  const loadOverview = useCallback(
    async (force = false) => {
      const seq = ++fetchSeqRef.current;
      try {
        const resp = await fetch(`/api/public/overview?_=${Date.now()}`, {
          cache: 'no-store',
          credentials: 'include',
        });
        if (!resp.ok) return;

        const etagHeader = resp.headers.get('etag') || '';
        const verMatch = etagHeader.match(/v(\d+)/);
        const incomingVer = verMatch ? Number(verMatch[1]) : 0;

        // Prevent slower older HTTP responses from overwriting a newer SSE direct patch
        if (!force && incomingVer > 0 && incomingVer < latestVersionRef.current) {
          return;
        }
        if (seq < fetchSeqRef.current && incomingVer <= latestVersionRef.current) {
          return;
        }
        if (incomingVer > latestVersionRef.current) {
          latestVersionRef.current = incomingVer;
        }

        const ov = (await resp.json()) as OverviewData;
        setData(ov);

        const matchedScreen = screenSlug
          ? (ov.tvScreens ?? []).find((s) => s.slug === screenSlug)
          : !hasExplicitMatchParam
            ? (ov.tvScreens ?? [])[0]
            : undefined;
        if (matchedScreen) {
          applyRemoteScreenConfig(matchedScreen, ov.matches, ov.masterCourts);
          return;
        }

        setSelectedTournamentId((prev) => {
          if (prev && (ov.tournaments ?? []).some((t) => t.id === prev)) return prev;
          return ov.tournaments?.[0]?.id ?? null;
        });
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
        setSecondaryMatchId((prev) => {
          const list = (ov.matches ?? []).filter(
            (m) => m.status !== 'bye' && (m.teamAId || m.teamBId)
          );
          if (prev && list.some((m) => m.id === prev)) return prev;
          const liveList = list.filter((m) => m.status === 'live');
          if (liveList.length >= 2) return liveList[1]!.id;
          return list[1]?.id ?? null;
        });
      } catch {
        // ignore transient network glitches on TV display
      }
    },
    [screenSlug, hasExplicitMatchParam, applyRemoteScreenConfig]
  );

  // Zero-latency in-memory patch when `match_updated` arrives over SSE
  const applyIncomingMatch = useCallback(
    (rawData: string, lastEventId?: string) => {
      try {
        const incoming = JSON.parse(rawData) as Match;
        if (!incoming || typeof incoming.id !== 'number') {
          loadOverview(true);
          return;
        }
        const evVer = lastEventId ? Number(lastEventId) : 0;
        if (Number.isFinite(evVer) && evVer > latestVersionRef.current) {
          latestVersionRef.current = evVer;
        }

        setData((prev) => {
          if (!prev) return prev;
          const idx = prev.matches.findIndex((m) => m.id === incoming.id);
          if (idx === -1) return prev;
          const nextMatches = [...prev.matches];
          const existing = nextMatches[idx]!;
          nextMatches[idx] = {
            ...existing,
            ...incoming,
            sets: Array.isArray(incoming.sets) ? incoming.sets : existing.sets,
          };
          return { ...prev, matches: nextMatches };
        });

        // When a match finishes or resets, also pull full overview so bracket advancements sync immediately
        if (incoming.status === 'finished' || incoming.status === 'scheduled') {
          loadOverview(true);
        }
      } catch {
        loadOverview(true);
      }
    },
    [loadOverview]
  );

  useEffect(() => {
    syncDocumentBranding(
      data?.settings,
      activeScreen ? `Layar TV • ${activeScreen.name}` : 'Layar TV Arena'
    );
  }, [data?.settings, activeScreen]);

  useEffect(() => {
    apiFetch<{ unlocked: boolean; publicTvEnabled?: boolean }>('/api/public/tv-check')
      .then((res) => {
        setVipAuthorized(res.unlocked);
        setUnlocked(Boolean(res.unlocked || res.publicTvEnabled));
      })
      .catch(() => {
        setVipAuthorized(false);
        setUnlocked(false);
      });
    loadOverview(true);
  }, [loadOverview]);

  useEffect(() => {
    if (tvMode !== 'standby') return;
    const t = window.setInterval(() => setNowClock(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [tvMode]);

  useEffect(() => {
    if (!unlocked) return;
    loadOverview(true);

    let disposed = false;
    let activeEs: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let usePublicStreamFallback = !vipAuthorized;

    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = (delayMs = 2000) => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        openStream();
      }, delayMs);
    };

    const openStream = () => {
      if (disposed) return;
      activeEs?.close();

      const streamUrl = usePublicStreamFallback
        ? '/api/public/stream'
        : '/api/public/tv-stream';
      const source = new EventSource(streamUrl);
      activeEs = source;

      source.addEventListener('connected', (e) => {
        if (disposed) return;
        setConnected(true);
        try {
          const info = JSON.parse((e as MessageEvent).data) as { version?: number };
          if (info.version && info.version !== latestVersionRef.current) {
            loadOverview(true);
          }
        } catch {
          // ignore
        }
      });

      source.addEventListener('ping', (e) => {
        if (disposed) return;
        setConnected(true);
        try {
          const info = JSON.parse((e as MessageEvent).data) as { version?: number };
          if (info.version && info.version > latestVersionRef.current) {
            loadOverview(true);
          }
        } catch {
          // ignore legacy numeric ping
        }
      });

      source.addEventListener('match_updated', (e) => {
        const me = e as MessageEvent;
        applyIncomingMatch(me.data, me.lastEventId);
      });

      source.addEventListener('draw_slot_updated', (e) => {
        try {
          const payload = JSON.parse(
            (e as MessageEvent).data
          ) as DrawSlotBroadcastPayload;
          if (payload && payload.tournamentId) {
            setSelectedTournamentId(payload.tournamentId);
            if (!payload.cleared) {
              setRecentDrawEvent(payload);
              window.setTimeout(() => {
                setRecentDrawEvent((cur) =>
                  cur?.timestamp === payload.timestamp ? null : cur
                );
              }, 6500);
            }
          }
        } catch {
          // ignore
        }
        loadOverview(true);
      });

      source.addEventListener('tv_screen_updated', (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as TvScreen;
          const targetSlug = screenSlug || activeScreen?.slug;
          if (targetSlug && payload && payload.slug === targetSlug) {
            applyRemoteScreenConfig(payload, data?.matches, data?.masterCourts);
          }
        } catch {
          // ignore
        }
        loadOverview(true);
      });

      for (const ev of [
        'bracket_updated',
        'master_teams_updated',
        'courts_updated',
        'tournament_updated',
        'settings_updated',
      ]) {
        source.addEventListener(ev, () => {
          loadOverview(true);
        });
      }

      source.onerror = () => {
        if (disposed) return;
        setConnected(false);
        source.close();
        activeEs = null;

        // Verify whether VIP cookie is still valid or should fall back to public stream, then reconnect
        apiFetch<{ unlocked: boolean }>('/api/public/tv-check')
          .then((chk) => {
            usePublicStreamFallback = !chk.unlocked;
          })
          .catch(() => {
            usePublicStreamFallback = true;
          })
          .finally(() => {
            loadOverview(true);
            scheduleReconnect(2000);
          });
      };
    };

    openStream();

    // Safety-net sync loop: fast 2.5s sync if SSE is reconnecting, gentle 8s check while connected
    const syncInterval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      loadOverview(false);
    }, 3000);

    const onWake = () => {
      if (document.visibilityState === 'visible') {
        loadOverview(true);
        if (!activeEs || activeEs.readyState === EventSource.CLOSED) {
          clearReconnect();
          openStream();
        }
      }
    };

    const onOnline = () => {
      loadOverview(true);
      clearReconnect();
      openStream();
    };

    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onOnline);
    document.addEventListener('fullscreenchange', onFsChange);

    return () => {
      disposed = true;
      clearReconnect();
      window.clearInterval(syncInterval);
      activeEs?.close();
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [
    unlocked,
    vipAuthorized,
    screenSlug,
    loadOverview,
    applyIncomingMatch,
    applyRemoteScreenConfig,
  ]);

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
      setVipAuthorized(true);
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

  const activeBracketTournament: Tournament | undefined =
    (data?.tournaments ?? []).find((t) => t.id === selectedTournamentId) ??
    data?.tournaments?.[0];
  const bracketCategoryTeams = (data?.teams ?? []).filter(
    (t) => t.tournamentId === activeBracketTournament?.id
  );
  const bracketCategoryMatches = (data?.matches ?? []).filter(
    (m) => m.tournamentId === activeBracketTournament?.id
  );
  const filledDrawSlots = bracketCategoryTeams.filter(
    (t) => !isPlaceholderDrawSlotName(t.name)
  ).length;

  const teamA = primaryMatch?.teamAId ? teamMap.get(primaryMatch.teamAId) : null;
  const teamB = primaryMatch?.teamBId ? teamMap.get(primaryMatch.teamBId) : null;
  const category = primaryMatch ? tournamentMap.get(primaryMatch.tournamentId) : null;
  const activeSet = primaryMatch?.sets.find(
    (s) => s.setNumber === primaryMatch.currentSet
  );
  const lastPlayedSet =
    primaryMatch && primaryMatch.sets.length > 0
      ? ([...primaryMatch.sets]
          .reverse()
          .find((s) => s.isFinished || s.scoreA > 0 || s.scoreB > 0) ??
        primaryMatch.sets[primaryMatch.sets.length - 1])
      : undefined;
  const isLive = primaryMatch?.status === 'live';
  const isFinished = primaryMatch?.status === 'finished';
  const isWinnerA = Boolean(
    isFinished && primaryMatch?.winnerId && primaryMatch.winnerId === primaryMatch.teamAId
  );
  const isWinnerB = Boolean(
    isFinished && primaryMatch?.winnerId && primaryMatch.winnerId === primaryMatch.teamBId
  );

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
              {tvMode === 'standby'
                ? `${activeScreen?.bannerBadge || 'STANDBY ARENA'} • ${data?.settings?.eventSubtitle || 'SVC Arena'}`
                : tvMode === 'bracket'
                  ? `Live Bagan & Technical Meeting • ${activeBracketTournament?.name || 'SVC'} (${filledDrawSlots}/${bracketCategoryTeams.length} Slot Terisi)`
                  : tvMode === 'split'
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
          {/* Screen Profile Picker only when browsing bare /tv without ?screen= or ?match= */}
          {!screenSlug && !hasExplicitMatchParam && (data?.tvScreens ?? []).length > 1 && (
            <select
              value={activeScreen?.slug ?? ''}
              onChange={(e) => {
                const nextSlug = e.target.value;
                if (!nextSlug) return;
                setScreenSlug(nextSlug);
                window.history.replaceState(null, '', `/tv?screen=${nextSlug}`);
                const matched = (data?.tvScreens ?? []).find((s) => s.slug === nextSlug);
                if (matched) {
                  applyRemoteScreenConfig(matched, data?.matches, data?.masterCourts);
                }
              }}
              aria-label="Pilih Profil Layar TV"
              className="min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 focus:border-amber-400"
            >
              {(data?.tvScreens ?? []).map((scr) => (
                <option key={scr.id} value={scr.slug}>
                  Layar: {scr.name}
                </option>
              ))}
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

      {/* Main Giant Arena Scoreboard, Standby Banner, or Live TM Drawing Bracket */}
      <main
        className={`relative z-10 mx-auto flex w-full flex-1 flex-col justify-center px-4 py-6 sm:px-8 ${
          tvMode === 'bracket' ? 'max-w-[1680px]' : 'max-w-7xl'
        }`}
      >
        {tvMode === 'standby' ? (
          <div className="animate-page-enter relative flex min-h-[60vh] flex-col items-center justify-center overflow-hidden rounded-3xl border border-amber-500/35 bg-slate-900/75 px-6 py-10 text-center shadow-2xl">
            {activeScreen?.customBannerUrl && (
              <>
                <img
                  src={activeScreen.customBannerUrl}
                  alt="Standby Arena Banner"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/75 via-slate-950/60 to-slate-950/90" />
              </>
            )}

            <div className="relative z-10 flex w-full max-w-4xl flex-col items-center space-y-5">
              {/* Co-Branding & Event Crests */}
              <div className="flex flex-wrap items-center justify-center gap-4">
                <img
                  src={data?.settings?.logoUrl || '/brand/svc-crest-color.svg'}
                  alt="SVC Crest"
                  className="h-20 w-20 object-contain drop-shadow-[0_0_25px_rgba(245,197,56,0.3)] sm:h-24 sm:w-24"
                />
                {data?.settings?.coBrandLogoUrl && (
                  <div className="rounded-2xl border border-amber-400/25 bg-slate-950/85 px-4 py-2.5 shadow-lg">
                    <img
                      src={data.settings.coBrandLogoUrl}
                      alt="AVERSA"
                      className="h-10 w-auto max-w-[140px] object-contain sm:h-12"
                    />
                  </div>
                )}
                {data?.settings?.organizerLogoUrl && (
                  <img
                    src={data.settings.organizerLogoUrl}
                    alt="Penyelenggara"
                    className="h-14 w-14 object-contain sm:h-16 sm:w-16"
                  />
                )}
              </div>

              {/* Pulsing Status Badge */}
              <span className="sport-skew inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-1.5 text-sm font-extrabold uppercase tracking-widest text-slate-950 shadow-lg shadow-amber-500/30">
                <span className="sport-unskew inline-flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-slate-950" />
                  {activeScreen?.bannerBadge || 'STANDBY ARENA'}
                </span>
              </span>

              {/* Main Display Title & Subtitle */}
              <div className="space-y-2">
                <h2 className="font-display text-4xl font-extrabold uppercase tracking-wider text-white drop-shadow sm:text-6xl lg:text-7xl">
                  {activeScreen?.bannerTitle || 'TECHNICAL MEETING & DRAWING'}
                </h2>
                <p className="mx-auto max-w-3xl text-base font-semibold text-amber-300/90 sm:text-xl">
                  {activeScreen?.bannerSubtitle ||
                    data?.settings?.eventSubtitle ||
                    'Smansage Volleyball Competition'}
                </p>
              </div>

              {/* Live WIB Digital Clock */}
              {(activeScreen?.showClock ?? true) && (
                <div className="inline-flex items-center gap-3 rounded-2xl border border-slate-700/80 bg-slate-950/90 px-6 py-3 shadow-inner">
                  <Clock className="h-6 w-6 text-amber-400" />
                  <span className="font-display text-3xl font-extrabold tracking-widest text-white tabular-nums sm:text-4xl">
                    {nowClock.toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })}{' '}
                    <span className="text-lg text-amber-400">WIB</span>
                  </span>
                </div>
              )}

              {/* Upcoming Match Card inside Standby if preset is 'upcoming' */}
              {activeScreen?.bannerPreset === 'upcoming' && primaryMatch && (
                <div className="mt-2 grid w-full max-w-2xl grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-2xl border border-amber-400/35 bg-slate-950/85 px-5 py-4">
                  <div className="flex min-w-0 items-center justify-end gap-3 text-right">
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg font-extrabold uppercase text-white sm:text-2xl">
                        {teamA?.name || 'TIM A'}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {teamA?.school}
                      </p>
                    </div>
                    <TeamAvatar team={teamA} size="md" />
                  </div>
                  <div className="text-center">
                    <span className="block rounded-lg bg-amber-500/20 px-3 py-1 font-display text-xl font-extrabold text-amber-400">
                      VS
                    </span>
                    <span className="mt-1 block text-[11px] font-bold text-slate-400">
                      {primaryMatch.courtName}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-center gap-3 text-left">
                    <TeamAvatar team={teamB} size="md" />
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg font-extrabold uppercase text-white sm:text-2xl">
                        {teamB?.name || 'TIM B'}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {teamB?.school}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Dynamic Marquee Running Text */}
            {activeScreen?.bannerNoticeText?.trim() && (
              <div className="relative z-10 mt-8 w-full overflow-hidden rounded-xl border border-amber-500/30 bg-slate-950/90 py-2.5">
                <div className="animate-tv-marquee text-sm font-bold uppercase tracking-wide text-amber-300 sm:text-base">
                  {activeScreen.bannerNoticeText}
                </div>
              </div>
            )}
          </div>
        ) : tvMode === 'bracket' ? (
          <div className="animate-page-enter space-y-5">
            {/* Live TM Drawing Spotlight Reveal Banner */}
            {recentDrawEvent &&
              recentDrawEvent.tournamentId === activeBracketTournament?.id && (
                <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 rounded-3xl border-2 border-amber-400 bg-slate-900/95 px-6 py-4 shadow-2xl shadow-amber-500/20">
                  <div className="flex min-w-0 items-center gap-4">
                    <TeamAvatar
                      team={{
                        name: recentDrawEvent.teamName,
                        shortCode: recentDrawEvent.teamName.slice(0, 4),
                        logoUrl: recentDrawEvent.logoUrl,
                        color: '#E09D17',
                      }}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <span className="sport-skew inline-block rounded bg-amber-500 px-3 py-0.5 text-xs font-extrabold uppercase tracking-wider text-slate-950">
                        <span className="sport-unskew">HASIL UNDIAN MASUK</span>
                      </span>
                      <h2 className="mt-1 truncate font-display text-2xl font-extrabold uppercase tracking-wide text-white sm:text-4xl">
                        {recentDrawEvent.teamName}
                      </h2>
                      {recentDrawEvent.school && (
                        <p className="truncate text-sm font-semibold text-amber-300">
                          {recentDrawEvent.school}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 rounded-2xl border border-amber-400/50 bg-slate-950 px-5 py-3 text-center">
                    <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                      POSISI SLOT
                    </span>
                    <span className="font-display text-2xl font-extrabold uppercase text-amber-400 sm:text-3xl">
                      {recentDrawEvent.poolName
                        ? `POOL ${recentDrawEvent.poolName}`
                        : `UNDIAN #${String(recentDrawEvent.slotNumber).padStart(2, '0')}`}
                    </span>
                  </div>
                </div>
              )}

            {activeBracketTournament?.format === 'pool_knockout' && (
              <PoolStandingsView
                tournament={activeBracketTournament}
                teams={bracketCategoryTeams}
                matches={bracketCategoryMatches}
              />
            )}

            <BracketView
              matches={bracketCategoryMatches}
              teams={bracketCategoryTeams}
              highlightedTeamId={
                recentDrawEvent &&
                recentDrawEvent.tournamentId === activeBracketTournament?.id
                  ? recentDrawEvent.teamId
                  : null
              }
            />
          </div>
        ) : !primaryMatch ? (
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
                    <Trophy className="h-4 w-4" /> PERTANDINGAN SELESAI • SKOR AKHIR
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
                  (primaryMatch.servingTeam === 'A' && isLive) || isWinnerA
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
                  {isWinnerA && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-extrabold uppercase text-slate-950 shadow-lg shadow-amber-400/30">
                      <Trophy className="h-4 w-4" />
                      PEMENANG
                    </span>
                  )}
                </div>

                <div className="my-4 text-center font-display text-8xl font-extrabold leading-none tabular-nums tracking-tight sm:text-[9.5rem] xl:text-[11.5rem]">
                  <span
                    className={
                      (primaryMatch.servingTeam === 'A' && isLive) || isWinnerA
                        ? 'text-amber-400 drop-shadow-[0_0_25px_rgba(245,197,56,0.25)]'
                        : 'text-white'
                    }
                  >
                    {isLive && activeSet ? activeSet.scoreA : primaryMatch.setsWonA}
                  </span>
                </div>

                {isLive && activeSet ? (
                  <div className="pl-2">
                    <TvCounterBadgeRow
                      timeoutsUsed={activeSet.timeoutsA ?? 0}
                      subsUsed={activeSet.subsA ?? 0}
                      align="left"
                    />
                  </div>
                ) : isFinished && lastPlayedSet ? (
                  <div className="flex justify-start pl-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/85 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-slate-300">
                      <span className="text-slate-400">
                        SET TERAKHIR (SET {lastPlayedSet.setNumber}):
                      </span>
                      <span className="tabular-nums text-amber-400">
                        {lastPlayedSet.scoreA} Poin
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>

              {/* CENTER SETS & HISTORY */}
              <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-slate-800 bg-slate-950/90 p-5 text-center">
                <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
                  {isFinished ? 'SKOR AKHIR SET' : 'SKOR SET'}
                </span>
                <div className="flex items-center gap-3 font-display text-6xl font-extrabold tabular-nums text-amber-400">
                  <span>{primaryMatch.setsWonA}</span>
                  <span className="text-3xl text-slate-600">-</span>
                  <span>{primaryMatch.setsWonB}</span>
                </div>

                {primaryMatch.sets.length > 0 && (
                  <div className="mt-2 w-full space-y-1.5 border-t border-slate-800 pt-3">
                    {primaryMatch.sets.map((s) => {
                      const isHighlightedSet =
                        (isLive && s.setNumber === primaryMatch.currentSet) ||
                        (isFinished &&
                          lastPlayedSet &&
                          s.setNumber === lastPlayedSet.setNumber);
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center justify-between rounded-lg px-3 py-1 text-xs font-bold tabular-nums ${
                            isHighlightedSet
                              ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                              : 'bg-slate-900 text-slate-300'
                          }`}
                        >
                          <span className={isHighlightedSet ? 'text-amber-300' : 'text-slate-500'}>
                            SET {s.setNumber}
                          </span>
                          <span>
                            {s.scoreA} - {s.scoreB}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* TEAM B PANEL */}
              <div
                className={`relative flex flex-col justify-between overflow-hidden rounded-3xl border bg-slate-900/90 p-6 shadow-2xl transition-all sm:p-8 ${
                  (primaryMatch.servingTeam === 'B' && isLive) || isWinnerB
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
                  {isWinnerB && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-extrabold uppercase text-slate-950 shadow-lg shadow-amber-400/30">
                      <Trophy className="h-4 w-4" />
                      PEMENANG
                    </span>
                  )}
                </div>

                <div className="my-4 text-center font-display text-8xl font-extrabold leading-none tabular-nums tracking-tight sm:text-[9.5rem] xl:text-[11.5rem]">
                  <span
                    className={
                      (primaryMatch.servingTeam === 'B' && isLive) || isWinnerB
                        ? 'text-amber-400 drop-shadow-[0_0_25px_rgba(245,197,56,0.25)]'
                        : 'text-white'
                    }
                  >
                    {isLive && activeSet ? activeSet.scoreB : primaryMatch.setsWonB}
                  </span>
                </div>

                {isLive && activeSet ? (
                  <div className="pr-2">
                    <TvCounterBadgeRow
                      timeoutsUsed={activeSet.timeoutsB ?? 0}
                      subsUsed={activeSet.subsB ?? 0}
                      align="right"
                    />
                  </div>
                ) : isFinished && lastPlayedSet ? (
                  <div className="flex justify-end pr-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/85 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-slate-300">
                      <span className="text-slate-400">
                        SET TERAKHIR (SET {lastPlayedSet.setNumber}):
                      </span>
                      <span className="tabular-nums text-amber-400">
                        {lastPlayedSet.scoreB} Poin
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Organizer & Sponsors Strip */}
      {(tvMode !== 'standby' || activeScreen?.showSponsors !== false) && (
        <PartnersFooter settings={data?.settings} compact />
      )}
    </div>
  );
}

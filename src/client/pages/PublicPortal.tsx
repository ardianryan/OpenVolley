import {
  Calendar,
  Camera,
  Download,
  GitBranch,
  Radio,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SupportedErrorCode } from '../../shared/routes';
import { formatInternationalStageLabel } from '../../shared/stages';
import { BracketView } from '../components/BracketView';
import { ErrorPage } from '../components/ErrorPage';
import { GalleryMediaCard } from '../components/GalleryMediaCard';
import { MatchCenterModal } from '../components/MatchCenterModal';
import { PartnersFooter } from '../components/PartnersFooter';
import { PoolStandingsView } from '../components/PoolStandingsView';
import { PwaInstallButton } from '../components/PwaInstallButton';
import { TeamAvatar } from '../components/TeamAvatar';
import { ThemeToggle } from '../components/ThemeToggle';
import { VolleyballArena3D } from '../components/VolleyballArena3D';
import { VolleyballIcon } from '../components/VolleyballIcon';
import { ApiError, apiFetch } from '../lib/api';
import { syncDocumentBranding } from '../lib/seo';
import type { Match, OverviewData, Team } from '../types';

type PublicTab = 'live' | 'bracket' | 'reports';
type MatchFilter = 'all' | 'live' | 'scheduled' | 'finished';

const TAB_TO_PATH: Record<PublicTab, string> = {
  live: '/',
  bracket: '/bagan',
  reports: '/galeri',
};

function getInitialPublicTab(): PublicTab {
  if (typeof window === 'undefined') return 'live';
  const p = window.location.pathname;
  if (p === '/bagan' || p.startsWith('/bagan/')) return 'bracket';
  if (p === '/galeri' || p.startsWith('/galeri/')) return 'reports';
  if (p === '/live') return 'live';
  const saved = localStorage.getItem('ov_public_tab') as PublicTab | null;
  if (saved && saved in TAB_TO_PATH) return saved;
  return 'live';
}

export function PublicPortal() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [activeTab, setActiveTabState] = useState<PublicTab>(getInitialPublicTab);
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all');
  const [highlightedMatchId, setHighlightedMatchId] = useState<number | null>(null);
  const [detailMatchId, setDetailMatchId] = useState<number | null>(null);
  const [downloadingBulletin, setDownloadingBulletin] = useState(false);
  const [syncMode, setSyncMode] = useState<'sse' | 'polling' | 'connecting'>('connecting');
  const [portalError, setPortalError] = useState<{
    code: SupportedErrorCode;
    message?: string;
    retryAfterSec?: number;
  } | null>(null);

  const setActiveTab = useCallback((tab: PublicTab) => {
    setActiveTabState(tab);
    localStorage.setItem('ov_public_tab', tab);
    const targetPath = TAB_TO_PATH[tab];
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const p = window.location.pathname;
      if (p === '/bagan') setActiveTabState('bracket');
      else if (p === '/galeri') setActiveTabState('reports');
      else setActiveTabState('live');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const res = await apiFetch<OverviewData>('/api/public/overview');
      setPortalError(null);
      setData(res);
      setSelectedTournamentId((prev) => {
        if (prev && res.tournaments.some((t) => t.id === prev)) return prev;
        return res.tournaments[0]?.id ?? null;
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const mappedCode: SupportedErrorCode =
          err.status === 0
            ? 'offline'
            : err.status === 400 ||
                err.status === 401 ||
                err.status === 403 ||
                err.status === 404 ||
                err.status === 408 ||
                err.status === 429 ||
                err.status === 502 ||
                err.status === 503
              ? err.status
              : 500;
        setPortalError({
          code: mappedCode,
          message: err.message,
          retryAfterSec: err.retryAfterSec,
        });
      } else {
        setPortalError({ code: 500 });
      }
    }
  }, []);

  useEffect(() => {
    loadOverview();

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const startPollingFallback = (intervalMs = 5000) => {
      if (pollTimer) return;
      setSyncMode('polling');
      pollTimer = setInterval(() => {
        loadOverview();
      }, intervalMs);
    };

    const es = new EventSource('/api/public/stream');
    es.addEventListener('connected', () => setSyncMode('sse'));
    es.addEventListener('fallback', (e) => {
      es.close();
      try {
        const parsed = JSON.parse((e as MessageEvent).data) as { intervalMs?: number };
        startPollingFallback(parsed.intervalMs || 5000);
      } catch {
        startPollingFallback(5000);
      }
    });
    es.onerror = () => {
      // Gracefully fall back to async ETag polling instead of hammering SSE reconnects
      es.close();
      startPollingFallback(5000);
    };

    const events = [
      'match_updated',
      'bracket_updated',
      'report_added',
      'report_deleted',
      'tournament_updated',
      'settings_updated',
    ];
    for (const ev of events) {
      es.addEventListener(ev, () => {
        loadOverview();
      });
    }

    return () => {
      es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [loadOverview]);

  const settings = data?.settings;
  const tournaments = data?.tournaments ?? [];
  const activeTournament = tournaments.find((t) => t.id === selectedTournamentId) ?? tournaments[0];

  useEffect(() => {
    syncDocumentBranding(settings);
  }, [settings]);

  const categoryTeams = (data?.teams ?? []).filter(
    (t) => t.tournamentId === activeTournament?.id
  );
  const teamMap = new Map<number, Team>(categoryTeams.map((t) => [t.id, t]));

  const categoryMatches = (data?.matches ?? []).filter(
    (m) => m.tournamentId === activeTournament?.id
  );
  const mainRoundNums = categoryMatches
    .filter((m) => m.bracketType === 'main')
    .map((m) => m.round);
  const totalMainRounds =
    mainRoundNums.length > 0 ? Math.max(...mainRoundNums) : 3;
  const liveMatches = categoryMatches.filter((m) => m.status === 'live');
  const scheduledMatches = categoryMatches.filter(
    (m) => m.status === 'scheduled' && (m.teamAId || m.teamBId)
  );
  const finishedMatches = categoryMatches
    .filter((m) => m.status === 'finished')
    .reverse();

  const categoryMatchIds = new Set(categoryMatches.map((m) => m.id));
  const categoryReports = (data?.reports ?? []).filter((r) =>
    categoryMatchIds.has(r.matchId)
  );

  const featuredMatch =
    liveMatches[0] ?? scheduledMatches[0] ?? finishedMatches[0] ?? null;
  const featuredTeamA = featuredMatch?.teamAId
    ? teamMap.get(featuredMatch.teamAId)
    : null;
  const featuredTeamB = featuredMatch?.teamBId
    ? teamMap.get(featuredMatch.teamBId)
    : null;

  const renderMatchCard = (match: Match, idx = 0) => {
    const teamA = match.teamAId ? teamMap.get(match.teamAId) : null;
    const teamB = match.teamBId ? teamMap.get(match.teamBId) : null;
    const activeSet = match.sets.find((s) => s.setNumber === match.currentSet);
    const isLive = match.status === 'live';
    const isFinished = match.status === 'finished';

    return (
      <div
        key={match.id}
        role="button"
        tabIndex={0}
        aria-label={`Buka rincian laga ${teamA?.name || 'Menunggu'} melawan ${
          teamB?.name || 'Menunggu'
        }`}
        onClick={() => setDetailMatchId(match.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setDetailMatchId(match.id);
          }
        }}
        style={{ animationDelay: `${Math.min(idx * 45, 270)}ms` }}
        className={`animate-bracket-card group relative cursor-pointer overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl ${
          isLive
            ? 'border-amber-500/80 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 text-white shadow-xl shadow-amber-500/10'
            : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90'
        }`}
      >
        {/* Left & Right Vertical Team Color Accent Strips */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: teamA?.color || '#E09D17' }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-1.5"
          style={{ backgroundColor: teamB?.color || '#3B82F6' }}
        />

        {isLive && (
          <img
            src="/brand/svc-spiker-official.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-3 right-3 h-28 w-28 object-contain opacity-10"
          />
        )}

        {/* Top bar */}
        <div
          className={`flex items-center justify-between border-b px-4 py-2 text-xs font-semibold ${
            isLive
              ? 'border-slate-800 bg-slate-950/60 text-slate-300'
              : 'border-slate-100 bg-slate-50 text-slate-600 dark:border-slate-800/80 dark:bg-slate-950/40 dark:text-slate-400'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="sport-skew inline-block rounded bg-amber-500 px-2 py-0.5 text-[11px] font-extrabold uppercase text-slate-950">
              <span className="sport-unskew">{match.courtName}</span>
            </span>
            <span className="font-bold uppercase tracking-wider">
              {formatInternationalStageLabel(match, totalMainRounds)}
            </span>
          </div>

          {isLive ? (
            <span className="sport-skew inline-flex items-center gap-1.5 rounded bg-red-600 px-2.5 py-0.5 text-[11px] font-extrabold text-white shadow-sm">
              <span className="sport-unskew inline-flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                LIVE • SET {match.currentSet}
              </span>
            </span>
          ) : isFinished ? (
            <span className="sport-skew inline-block rounded bg-amber-500/18 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
              <span className="sport-unskew">FINAL</span>
            </span>
          ) : (
            <span className="text-xs font-semibold">{match.scheduledAt || 'Upcoming'}</span>
          )}
        </div>

        {/* Scoreboard body */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4 sm:gap-4 sm:p-5">
          {/* Team A */}
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <TeamAvatar team={teamA} size="lg" />
              {isLive && match.servingTeam === 'A' && (
                <span
                  title="Sedang Servis"
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow"
                >
                  <VolleyballIcon className="h-3 w-3" />
                </span>
              )}
            </div>
            <p
              className={`mt-2 line-clamp-2 text-sm font-bold sm:text-base ${
                isLive ? 'text-white' : 'text-slate-900 dark:text-white'
              }`}
            >
              {teamA?.name || 'Menunggu'}
            </p>
            {teamA?.school && (
              <p
                className={`mt-0.5 line-clamp-1 text-xs ${
                  isLive ? 'text-slate-300' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {teamA.school}
              </p>
            )}
          </div>

          {/* Center Score */}
          <div className="flex flex-col items-center">
            {isLive && activeSet ? (
              <>
                <span className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  Poin Set {match.currentSet}
                </span>
                <div className="flex items-center gap-2 font-display text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">
                  <span
                    className={
                      match.servingTeam === 'A' ? 'text-amber-400' : 'text-white'
                    }
                  >
                    {activeSet.scoreA}
                  </span>
                  <span className="text-xl text-slate-500">:</span>
                  <span
                    className={
                      match.servingTeam === 'B' ? 'text-amber-400' : 'text-white'
                    }
                  >
                    {activeSet.scoreB}
                  </span>
                </div>
                <div className="mt-1 rounded-full bg-slate-800 px-3 py-0.5 text-xs font-bold tabular-nums text-amber-300">
                  SKOR SET: {match.setsWonA} - {match.setsWonB}
                </div>
              </>
            ) : (
              <>
                  <span className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    {isFinished ? 'Final Set Score' : 'Set Score'}
                  </span>
                <div className="flex items-center gap-2 font-display text-3xl font-extrabold tabular-nums sm:text-4xl">
                  <span
                    className={
                      match.winnerId === match.teamAId
                        ? 'text-amber-700 dark:text-amber-400'
                        : isLive
                          ? 'text-white'
                          : 'text-slate-800 dark:text-slate-200'
                    }
                  >
                    {match.setsWonA}
                  </span>
                  <span className="text-lg text-slate-500">-</span>
                  <span
                    className={
                      match.winnerId === match.teamBId
                        ? 'text-amber-700 dark:text-amber-400'
                        : isLive
                          ? 'text-white'
                          : 'text-slate-800 dark:text-slate-200'
                    }
                  >
                    {match.setsWonB}
                  </span>
                </div>
              </>
            )}

            {/* Set History Pills */}
            {match.sets.length > 0 && (
              <div className="mt-2.5 flex flex-wrap justify-center gap-1">
                {match.sets.map((s) => (
                  <span
                    key={s.id}
                    className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                      s.setNumber === match.currentSet && isLive
                        ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                        : isLive
                          ? 'bg-slate-800 text-slate-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {s.scoreA}-{s.scoreB}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Team B */}
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <TeamAvatar team={teamB} size="lg" />
              {isLive && match.servingTeam === 'B' && (
                <span
                  title="Sedang Servis"
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow"
                >
                  <VolleyballIcon className="h-3 w-3" />
                </span>
              )}
            </div>
            <p
              className={`mt-2 line-clamp-2 text-sm font-bold sm:text-base ${
                isLive ? 'text-white' : 'text-slate-900 dark:text-white'
              }`}
            >
              {teamB?.name || 'Menunggu'}
            </p>
            {teamB?.school && (
              <p
                className={`mt-0.5 line-clamp-1 text-xs ${
                  isLive ? 'text-slate-300' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {teamB.school}
              </p>
            )}
          </div>
        </div>

        {/* Footer quick jump to Detail & Bracket */}
        <div
          className={`flex items-center justify-between border-t px-4 py-1.5 text-xs ${
            isLive
              ? 'border-slate-800/80 bg-slate-950/40 text-slate-300'
              : 'border-slate-100 bg-slate-50/70 text-slate-600 dark:border-slate-800/70 dark:bg-slate-950/30 dark:text-slate-400'
          }`}
        >
          <span className="font-semibold group-hover:text-amber-700 dark:group-hover:text-amber-400">
            Ketuk kartu untuk Rincian Set &amp; Foto
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHighlightedMatchId(match.id);
              setActiveTab('bracket');
            }}
            className={`inline-flex min-h-11 items-center rounded-lg px-2 font-bold hover:underline sm:min-h-8 ${
              isLive ? 'text-amber-300' : 'text-amber-800 dark:text-amber-400'
            }`}
          >
            Lihat di Bagan →
          </button>
        </div>
      </div>
    );
  };

  if (!data && portalError) {
    return (
      <ErrorPage
        code={portalError.code}
        customMessage={portalError.message}
        retryAfterSec={portalError.retryAfterSec}
        onRetry={loadOverview}
      />
    );
  }

  return (
    <div className="court-pattern flex min-h-screen flex-col">
      {/* Sticky Compact Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={settings?.logoUrl || '/brand/svc-crest-color.svg'}
              alt="Logo Event"
              className="h-10 w-10 shrink-0 object-contain drop-shadow-sm sm:h-11 sm:w-11"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-display text-lg font-extrabold uppercase tracking-wide text-slate-900 dark:text-white sm:text-xl">
                  {settings?.eventName || 'Smansage Volleyball Competition'}
                </h1>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                {settings?.coBrandLogoUrl && (
                  <img
                    src={settings.coBrandLogoUrl}
                    alt="AVERSA"
                    className="h-3.5 w-auto max-w-[54px] object-contain"
                  />
                )}
                <span className="truncate">
                  {settings?.eventSubtitle || 'AVERSA • Dies Natalis 44 SMA Negeri 1 Gedeg'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span
              title={
                syncMode === 'sse'
                  ? 'Live Stream SSE Terhubung'
                  : syncMode === 'polling'
                    ? 'Mode Hemat Server (Async Sync 5s)'
                    : 'Menghubungkan...'
              }
              className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold md:inline-flex ${
                syncMode === 'sse'
                  ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                  : syncMode === 'polling'
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              <Radio className="h-3 w-3" />
              {syncMode === 'sse'
                ? 'REAL-TIME'
                : syncMode === 'polling'
                  ? 'ASYNC SYNC'
                  : 'SYNCING'}
            </span>

            <PwaInstallButton />

            <ThemeToggle />

            <a
              href="/back-office"
              aria-label="Masuk halaman Panitia"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 transition hover:border-amber-600 hover:text-amber-800 sm:min-h-9 sm:py-1.5 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-amber-400/50 dark:hover:text-amber-300"
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Panitia</span>
            </a>
          </div>
        </div>

        {/* Category Pills + Main Nav Tabs */}
        <div className="mx-auto flex max-w-7xl flex-col gap-2 border-t border-slate-100 px-4 py-2 dark:border-slate-800/70 sm:flex-row sm:items-center sm:justify-between">
          {/* Dynamic Categories */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:pb-0">
            {tournaments.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTournamentId(t.id)}
                className={`min-h-11 shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition sm:min-h-8 sm:py-1 ${
                  t.id === activeTournament?.id
                    ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/30'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>

          {/* Portal Section Tabs */}
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900 sm:flex">
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold transition sm:min-h-9 sm:px-3 sm:py-1.5 ${
                activeTab === 'live'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-amber-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Skor &amp; Jadwal</span>
              {liveMatches.length > 0 && (
                <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                  {liveMatches.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('bracket')}
              className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold transition sm:min-h-9 sm:px-3 sm:py-1.5 ${
                activeTab === 'bracket'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-amber-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Bagan Turnamen</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('reports')}
              className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold transition sm:min-h-9 sm:px-3 sm:py-1.5 ${
                activeTab === 'reports'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-amber-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Camera className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Galeri Momen</span>
            </button>
          </div>
        </div>

        {/* Live Score Ticker when viewing Bracket or Gallery */}
        {activeTab !== 'live' && liveMatches.length > 0 && (
          <div className="border-t border-amber-500/20 bg-slate-950 px-4 py-1.5 text-white">
            <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-x-auto text-xs">
              <span className="sport-skew inline-flex shrink-0 items-center gap-1.5 rounded bg-red-600 px-2 py-0.5 font-extrabold">
                <span className="sport-unskew inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  LIVE TICKER
                </span>
              </span>
              {liveMatches.map((lm) => {
                const tA = lm.teamAId ? teamMap.get(lm.teamAId)?.shortCode : 'A';
                const tB = lm.teamBId ? teamMap.get(lm.teamBId)?.shortCode : 'B';
                const curSet = lm.sets.find((s) => s.setNumber === lm.currentSet);
                return (
                  <button
                    key={lm.id}
                    type="button"
                    onClick={() => setDetailMatchId(lm.id)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-slate-900 px-2.5 py-1 font-bold transition hover:bg-slate-800"
                  >
                    <span className="text-amber-400">{lm.courtName}:</span>
                    <span>
                      {tA}{' '}
                      <strong className="text-amber-400 tabular-nums">
                        {curSet ? `${curSet.scoreA}-${curSet.scoreB}` : `${lm.setsWonA}-${lm.setsWonB}`}
                      </strong>{' '}
                      {tB}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      (Set {lm.setsWonA}-{lm.setsWonB})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-5">
        {!data ? (
          <div className="animate-page-enter space-y-5">
            <div className="skeleton-shimmer h-72 w-full rounded-3xl sm:h-84" />
            <div className="flex gap-2">
              <div className="skeleton-shimmer h-9 w-24 rounded-full" />
              <div className="skeleton-shimmer h-9 w-28 rounded-full" />
              <div className="skeleton-shimmer h-9 w-24 rounded-full" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="skeleton-shimmer h-44 rounded-2xl border border-slate-200/40 dark:border-slate-800/60"
                />
              ))}
            </div>
          </div>
        ) : (
          <>
            <VolleyballArena3D
              logoUrl={settings?.logoUrl}
              eventName={settings?.eventName || 'Smansage Volleyball Competition'}
              eventSubtitle={
                settings?.eventSubtitle || 'AVERSA • Dies Natalis 44 SMA Negeri 1 Gedeg'
              }
              eventMeta={settings?.eventMeta || '1982 - 2026 • Mojokerto'}
              categoryName={activeTournament?.name}
              teamCount={categoryTeams.length}
              liveCount={liveMatches.length}
              finishedCount={finishedMatches.length}
              featuredMatch={featuredMatch}
              featuredTeamA={featuredTeamA}
              featuredTeamB={featuredTeamB}
              onOpenBracket={() => setActiveTab('bracket')}
              onSelectMatch={(id) => setDetailMatchId(id)}
            />

            {activeTab === 'live' && (
              <div key="tab-live" className="animate-page-enter space-y-6">
            {/* Quick Status Filter Pills */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['all', `Semua (${liveMatches.length + scheduledMatches.length + finishedMatches.length})`],
                    ['live', `Sedang Live (${liveMatches.length})`],
                    ['scheduled', `Akan Main (${scheduledMatches.length})`],
                    ['finished', `Selesai (${finishedMatches.length})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMatchFilter(key)}
                    className={`min-h-11 rounded-full px-3.5 py-2 text-xs font-bold transition sm:min-h-8 sm:py-1.5 ${
                      matchFilter === key
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activeTournament && (
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Default: Best of {activeTournament.bestOf} ({activeTournament.regularSetPoints}/
                  {activeTournament.decidingSetPoints} pts)
                </span>
              )}
            </div>

            {/* Active Live Matches */}
            {(matchFilter === 'all' || matchFilter === 'live') && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                  <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                    Pertandingan Berlangsung
                  </h2>
                </div>
                {liveMatches.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {liveMatches.map((m, idx) => renderMatchCard(m, idx))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center dark:border-slate-800 dark:bg-slate-900/40">
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                      Belum ada pertandingan yang sedang berlangsung pada kategori ini.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* Upcoming Matches */}
            {(matchFilter === 'all' || matchFilter === 'scheduled') &&
              scheduledMatches.length > 0 && (
                <section>
                  <h2 className="mb-3 font-display text-lg font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Jadwal Pertandingan
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {scheduledMatches.map((m, idx) => renderMatchCard(m, idx))}
                  </div>
                </section>
              )}

            {/* Finished Matches */}
            {(matchFilter === 'all' || matchFilter === 'finished') &&
              finishedMatches.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                    <h2 className="font-display text-lg font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      Hasil Pertandingan
                    </h2>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {finishedMatches.map((m, idx) => renderMatchCard(m, idx))}
                  </div>
                </section>
              )}
          </div>
        )}

        {activeTab === 'bracket' && (
          <div key="tab-bracket" className="animate-page-enter space-y-5">
            {settings?.publicDocsEnabled !== false && data && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div>
                  <p className="font-display text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                    Publikasi Buletin Resmi Turnamen
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Unduh dokumen PDF resmi berisi daftar kontingen, jadwal/hasil, dan bagan vektor.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={downloadingBulletin}
                  onClick={async () => {
                    if (downloadingBulletin || !data) return;
                    setDownloadingBulletin(true);
                    try {
                      const { downloadTournamentBulletinPdf } = await import(
                        '../lib/pdfDocuments'
                      );
                      await downloadTournamentBulletinPdf(data);
                    } finally {
                      setDownloadingBulletin(false);
                    }
                  }}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-sm transition hover:bg-amber-400 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {downloadingBulletin
                    ? 'Menyiapkan PDF...'
                    : 'Unduh Buletin Resmi (PDF)'}
                </button>
              </div>
            )}

            {activeTournament?.format === 'pool_knockout' && (
              <PoolStandingsView
                tournament={activeTournament}
                teams={categoryTeams}
                matches={categoryMatches}
                onSelectMatch={(m) => setDetailMatchId(m.id)}
              />
            )}

            <BracketView
              matches={categoryMatches}
              teams={categoryTeams}
              highlightedMatchId={highlightedMatchId}
              onSelectMatch={(m) => setDetailMatchId(m.id)}
            />
          </div>
        )}

        {activeTab === 'reports' && (
          <div key="tab-reports" className="animate-page-enter">
            {categoryReports.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center dark:border-slate-800 dark:bg-slate-900/40">
                <Camera className="mx-auto mb-3 h-10 w-10 text-amber-500/60" />
                <p className="font-semibold">Belum ada dokumentasi Galeri Momen</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Tim Media dapat mengunggah foto, slide highlight, maupun video pertandingan melalui Media Studio.
                </p>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {categoryReports.map((rep) => (
                  <GalleryMediaCard key={rep.id} report={rep} />
                ))}
              </div>
            )}
          </div>
        )}
          </>
        )}
      </main>

      {/* Official Organizer & Sponsors Footer */}
      {data && <PartnersFooter settings={settings} />}

      {/* Match Center Detail Modal / Bottom Sheet */}
      {detailMatchId &&
        (() => {
          const detailMatch = (data?.matches ?? []).find(
            (m) => m.id === detailMatchId
          );
          if (!detailMatch) return null;
          const dTeamA = detailMatch.teamAId
            ? teamMap.get(detailMatch.teamAId)
            : null;
          const dTeamB = detailMatch.teamBId
            ? teamMap.get(detailMatch.teamBId)
            : null;
          return (
            <MatchCenterModal
              match={detailMatch}
              teamA={dTeamA}
              teamB={dTeamB}
              categoryName={activeTournament?.name}
              tournament={activeTournament}
              settings={settings}
              totalMainRounds={totalMainRounds}
              reports={data?.reports ?? []}
              onClose={() => setDetailMatchId(null)}
              onJumpToBracket={(id) => {
                setHighlightedMatchId(id);
                setActiveTab('bracket');
              }}
            />
          );
        })()}
    </div>
  );
}

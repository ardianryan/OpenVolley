import { CalendarClock, ShieldAlert, Trophy, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeAssetUrl } from '../../shared/sanitize';
import { TeamAvatar } from '../components/TeamAvatar';
import { apiFetch } from '../lib/api';
import type {
  Match,
  ObsOverlay,
  SiteSettings,
  SponsorItem,
  Team,
  TeamPlayer,
  Tournament,
} from '../types';

function parseSponsorsList(raw?: string | null): SponsorItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SponsorItem[]) : [];
  } catch {
    return [];
  }
}

interface UpcomingMatchSummary {
  id: number;
  courtName: string;
  scheduledAt: string | null;
  stageLabel: string | null;
  teamAName: string;
  teamBName: string;
  teamALogo: string | null;
  teamBLogo: string | null;
}

interface ObsStateResponse {
  overlay: Omit<ObsOverlay, 'accessToken'>;
  match: Match | null;
  teamA: Team | null;
  teamB: Team | null;
  tournament: Tournament | null;
  rosterA?: TeamPlayer[];
  rosterB?: TeamPlayer[];
  upcomingMatches?: UpcomingMatchSummary[];
  settings: SiteSettings;
}

function renderObsSponsorImg(
  item: SponsorItem,
  themeMode: ObsOverlay['themeMode'],
  sizeClass: string
) {
  const isLight = themeMode === 'light';
  const rawUrl = isLight ? item.logoUrl : item.darkLogoUrl || item.logoUrl;
  const safeUrl = sanitizeAssetUrl(rawUrl);
  if (!safeUrl) return null;
  const needsBox = !isLight && item.boxed && !item.darkLogoUrl;
  return (
    <img
      key={item.id}
      src={safeUrl}
      alt={item.name}
      title={item.name}
      className={`${sizeClass} object-contain ${
        needsBox ? 'rounded-md bg-white px-1.5 py-0.5 shadow-xs' : ''
      }`}
    />
  );
}

export function ObsOverlayDisplay() {
  const [state, setState] = useState<ObsStateResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Transition state machine (exit -> swap -> enter)
  const [renderedOverlay, setRenderedOverlay] = useState<Omit<ObsOverlay, 'accessToken'> | null>(
    null
  );
  const [animPhase, setAnimPhase] = useState<'idle' | 'entering' | 'exiting'>('idle');
  const transitionTimerRef = useRef<number | null>(null);

  // Stinger Bumper state
  const [stingerEvent, setStingerEvent] = useState<{ label: string; key: number } | null>(null);

  // Auto-rotating sponsor index for Scorebug Corner Brand Bug
  const [sponsorTick, setSponsorTick] = useState(0);

  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const overlaySlug = params.get('overlay')?.trim() || '';
  const token = params.get('token')?.trim() || '';

  // Ensure OBS Browser Source canvas stays 100% transparent
  useEffect(() => {
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      setSponsorTick((n) => n + 1);
    }, 6000);
    return () => window.clearInterval(t);
  }, []);

  const loadObsState = useCallback(async () => {
    if (!token) {
      setAuthError('Token OBS tidak ditemukan pada URL (?token=...).');
      return;
    }
    try {
      const qs = new URLSearchParams({ token });
      if (overlaySlug) qs.set('overlay', overlaySlug);
      const res = await apiFetch<ObsStateResponse>(
        `/api/public/obs-state?${qs.toString()}&_=${Date.now()}`,
        { cache: 'no-store' }
      );
      setAuthError(null);
      setState(res);
    } catch (err) {
      setAuthError((err as Error).message || 'Akses OBS ditolak (403).');
    }
  }, [overlaySlug, token]);

  useEffect(() => {
    loadObsState();
    if (!token) return;

    const qs = new URLSearchParams({ token });
    if (overlaySlug) qs.set('overlay', overlaySlug);
    const es = new EventSource(`/api/public/obs-stream?${qs.toString()}`);

    const onRefresh = () => {
      void loadObsState();
    };
    es.addEventListener('obs_overlay_updated', onRefresh);
    es.addEventListener('match_updated', onRefresh);
    es.addEventListener('bracket_updated', onRefresh);
    es.addEventListener('settings_updated', onRefresh);

    es.addEventListener('obs_stinger_triggered', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data) as {
          slug?: string;
          label?: string;
          timestamp?: number;
        };
        if (overlaySlug && payload.slug && payload.slug !== overlaySlug) return;
        setStingerEvent({
          label: payload.label || 'LIVE BROADCAST',
          key: payload.timestamp || Date.now(),
        });
        window.setTimeout(() => {
          setStingerEvent((cur) =>
            cur && cur.key === (payload.timestamp || cur.key) ? null : cur
          );
        }, 1250);
      } catch {
        // ignore
      }
    });

    const poll = window.setInterval(loadObsState, 12000);
    return () => {
      es.close();
      window.clearInterval(poll);
    };
  }, [loadObsState, overlaySlug, token]);

  // Smooth transition state machine when preset or visibility changes
  useEffect(() => {
    const nextOv = state?.overlay;
    if (!nextOv) return;

    if (!renderedOverlay) {
      setRenderedOverlay(nextOv);
      if (nextOv.isVisible && nextOv.transitionPreset !== 'cut') {
        setAnimPhase('entering');
        transitionTimerRef.current = window.setTimeout(() => setAnimPhase('idle'), 400);
      }
      return;
    }

    const layoutChanged = renderedOverlay.layoutPreset !== nextOv.layoutPreset;
    const visChanged = renderedOverlay.isVisible !== nextOv.isVisible;
    const preset = nextOv.transitionPreset || 'broadcast_wipe';

    if (!layoutChanged && !visChanged) {
      setRenderedOverlay(nextOv);
      return;
    }

    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    if (preset === 'cut') {
      setRenderedOverlay(nextOv);
      setAnimPhase('idle');
      return;
    }

    if (renderedOverlay.isVisible) {
      setAnimPhase('exiting');
      transitionTimerRef.current = window.setTimeout(() => {
        setRenderedOverlay(nextOv);
        if (nextOv.isVisible) {
          setAnimPhase('entering');
          transitionTimerRef.current = window.setTimeout(() => setAnimPhase('idle'), 400);
        } else {
          setAnimPhase('idle');
        }
      }, 250);
    } else {
      setRenderedOverlay(nextOv);
      if (nextOv.isVisible) {
        setAnimPhase('entering');
        transitionTimerRef.current = window.setTimeout(() => setAnimPhase('idle'), 400);
      }
    }
  }, [state?.overlay, renderedOverlay]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    };
  }, []);

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent p-6">
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/40 bg-slate-950/90 px-5 py-3.5 text-white shadow-2xl">
          <ShieldAlert className="h-5 w-5 shrink-0 text-red-400" />
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-red-300">
              OBS Access Denied (403)
            </p>
            <p className="text-xs text-slate-300">{authError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!state || !renderedOverlay) {
    return <div className="min-h-screen bg-transparent" />;
  }

  const overlay = renderedOverlay;
  const { match, teamA, teamB, tournament, settings } = state;
  const rosterA = state.rosterA ?? [];
  const rosterB = state.rosterB ?? [];
  const upcomingMatches = state.upcomingMatches ?? [];

  const activeSet =
    match?.sets.find((s) => s.setNumber === match.currentSet) ??
    match?.sets[match.sets.length - 1];
  const scoreA = activeSet?.scoreA ?? 0;
  const scoreB = activeSet?.scoreB ?? 0;
  const sponsors = parseSponsorsList(settings.sponsorsJson);
  const principalSponsors = sponsors.slice(0, 3);
  const mediaPartners = sponsors.slice(3);

  const surfaceClass =
    overlay.themeMode === 'light'
      ? 'border-slate-200/90 bg-white/95 text-slate-900 shadow-2xl'
      : overlay.themeMode === 'glass'
        ? 'border-white/25 bg-slate-950/65 text-white backdrop-blur-xl shadow-2xl'
        : 'border-slate-700/80 bg-slate-950/92 text-white shadow-2xl';

  const mutedText = overlay.themeMode === 'light' ? 'text-slate-500' : 'text-slate-300';
  const transPreset = overlay.transitionPreset || 'broadcast_wipe';
  const animClass =
    animPhase === 'entering' && transPreset !== 'cut'
      ? `obs-enter-${transPreset}`
      : animPhase === 'exiting' && transPreset !== 'cut'
        ? `obs-exit-${transPreset}`
        : '';

  const winnerTeam =
    match?.winnerId && teamA && match.winnerId === teamA.id
      ? teamA
      : match?.winnerId && teamB && match.winnerId === teamB.id
        ? teamB
        : null;

  const renderBrandSponsorBar = () => {
    if (!overlay.showBrandBug && (!overlay.showSponsorTicker || sponsors.length === 0)) {
      return null;
    }
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-500/20 bg-slate-500/10 px-5 py-2">
        {overlay.showBrandBug && (
          <div className="flex items-center gap-2.5">
            <img
              src={settings.logoUrl || '/brand/svc-crest-color.svg'}
              alt={settings.eventName}
              className="h-6 w-6 object-contain"
            />
            <img
              src={settings.organizerLogoUrl || '/brand/logo_smansage.png'}
              alt="Penyelenggara"
              className="h-6 w-6 object-contain"
            />
            {settings.coBrandLogoUrl && (
              <img
                src={settings.coBrandLogoUrl}
                alt="Co-Brand"
                className="h-4 w-auto max-w-[70px] object-contain"
              />
            )}
            <div className="border-l border-slate-500/25 pl-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                {settings.eventName || 'Smansage Volleyball Competition'}
              </p>
              <p className={`text-[9px] font-semibold ${mutedText}`}>
                {settings.eventSubtitle || 'Penyelenggara Resmi'}
              </p>
            </div>
          </div>
        )}

        {overlay.showSponsorTicker && sponsors.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {principalSponsors.length > 0 && (
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-extrabold uppercase tracking-wider ${mutedText}`}>
                  Sponsor:
                </span>
                {principalSponsors.map((sp) =>
                  renderObsSponsorImg(sp, overlay.themeMode, 'h-6 max-w-[90px]')
                )}
              </div>
            )}
            {mediaPartners.length > 0 && (
              <div className="flex items-center gap-2 border-l border-slate-500/25 pl-2.5">
                <span className={`text-[9px] font-extrabold uppercase tracking-wider ${mutedText}`}>
                  Media:
                </span>
                {mediaPartners.map((mp) =>
                  renderObsSponsorImg(mp, overlay.themeMode, 'h-5 max-w-[75px]')
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderStingerLayer = () => {
    if (!stingerEvent) return null;
    return (
      <div
        key={stingerEvent.key}
        className="pointer-events-none fixed inset-0 z-50 overflow-hidden bg-transparent"
      >
        {/* Diagonal sweep layers */}
        <div className="obs-stinger-sweep absolute -inset-x-24 inset-y-0 flex items-center justify-center bg-gradient-to-r from-amber-500 via-slate-950 to-amber-500 shadow-2xl">
          <div className="absolute inset-y-0 left-0 w-4 bg-amber-400" />
          <div className="absolute inset-y-0 right-0 w-4 bg-amber-400" />
        </div>
        {/* Center Event & Organizer Badge */}
        <div className="obs-stinger-badge absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-white">
          <div className="flex items-center gap-4 rounded-3xl border border-amber-400/50 bg-slate-950/85 px-8 py-5 shadow-2xl">
            <img
              src={settings.organizerLogoUrl || '/brand/logo_smansage.png'}
              alt="Penyelenggara"
              className="h-16 w-16 object-contain"
            />
            <img
              src={settings.logoUrl || '/brand/svc-crest-color.svg'}
              alt="Acara"
              className="h-20 w-20 object-contain drop-shadow-[0_0_20px_rgba(245,158,11,0.45)]"
            />
            {settings.coBrandLogoUrl && (
              <img
                src={settings.coBrandLogoUrl}
                alt="AVERSA"
                className="h-12 w-auto max-w-[140px] object-contain"
              />
            )}
          </div>
          <div className="rounded-full bg-amber-500 px-5 py-1.5 font-display text-sm font-black uppercase tracking-widest text-slate-950 shadow-lg">
            {stingerEvent.label}
          </div>
        </div>
      </div>
    );
  };

  const renderPresetContent = () => {
    if (!overlay.isVisible) return null;

    // 1. Scorebug Corner (Top-Left Compact Pill + Top-Right Brand/Sponsor Bug)
    if (overlay.layoutPreset === 'scorebug_corner') {
      const rotatingSponsor =
        sponsors.length > 0 ? sponsors[sponsorTick % sponsors.length] : null;
      return (
        <div className={`flex min-h-screen items-start justify-between bg-transparent p-6 ${animClass}`}>
          <div className={`inline-flex flex-col overflow-hidden rounded-2xl border ${surfaceClass}`}>
            <div className="flex items-center justify-between gap-4 border-b border-amber-500/25 bg-amber-500/15 px-3.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
              <span>{overlay.customBadgeText || settings.eventName}</span>
              <span>{match ? `SET ${match.currentSet} • ${match.courtName}` : 'STANDBY'}</span>
            </div>

            <div className="divide-y divide-slate-500/20">
              {[
                { team: teamA, side: 'A' as const, sets: match?.setsWonA ?? 0, pts: scoreA, to: activeSet?.timeoutsA ?? 0 },
                { team: teamB, side: 'B' as const, sets: match?.setsWonB ?? 0, pts: scoreB, to: activeSet?.timeoutsB ?? 0 },
              ].map((row) => {
                const serving = match?.status === 'live' && match?.servingTeam === row.side;
                return (
                  <div
                    key={row.side}
                    className="flex items-center justify-between gap-5 px-3.5 py-2"
                  >
                    <div className="flex min-w-[140px] items-center gap-2.5">
                      <div
                        className="h-6 w-1 rounded-full"
                        style={{ backgroundColor: row.team?.color || '#E09D17' }}
                      />
                      <TeamAvatar team={row.team} size="sm" />
                      <span className="font-display text-base font-extrabold uppercase tracking-wide">
                        {row.team?.shortCode || row.team?.name || `TIM ${row.side}`}
                      </span>
                      {serving && (
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {overlay.showTimeoutSub && (
                        <span className={`text-[10px] font-bold ${mutedText}`}>
                          TO {row.to}/2
                        </span>
                      )}
                      <span className="min-w-[26px] rounded-md bg-slate-500/20 px-1.5 py-0.5 text-center font-display text-sm font-bold">
                        {row.sets}
                      </span>
                      <span className="min-w-[36px] text-right font-display text-2xl font-black tabular-nums text-amber-400">
                        {row.pts}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top-Right Compact Corner Brand & Rotating Sponsor Bug */}
          {(overlay.showBrandBug || (overlay.showSponsorTicker && rotatingSponsor)) && (
            <div
              className={`inline-flex items-center gap-3 rounded-2xl border px-4 py-2 ${surfaceClass}`}
            >
              {overlay.showBrandBug && (
                <div className="flex items-center gap-2">
                  <img
                    src={settings.logoUrl || '/brand/svc-crest-color.svg'}
                    alt="Event"
                    className="h-8 w-8 object-contain"
                  />
                  <img
                    src={settings.organizerLogoUrl || '/brand/logo_smansage.png'}
                    alt="Penyelenggara"
                    className="h-8 w-8 object-contain"
                  />
                  {settings.coBrandLogoUrl && (
                    <img
                      src={settings.coBrandLogoUrl}
                      alt="AVERSA"
                      className="h-5 w-auto max-w-[72px] object-contain"
                    />
                  )}
                </div>
              )}

              {overlay.showSponsorTicker && rotatingSponsor && (
                <div className="flex items-center gap-2 border-l border-slate-500/25 pl-3">
                  <div className="text-right">
                    <p className={`text-[9px] font-extrabold uppercase tracking-wider ${mutedText}`}>
                      {sponsorTick % sponsors.length < 3 ? 'Official Sponsor' : 'Media Partner'}
                    </p>
                    <p className="text-[10px] font-bold text-amber-400">
                      {rotatingSponsor.name}
                    </p>
                  </div>
                  {renderObsSponsorImg(rotatingSponsor, overlay.themeMode, 'h-7 max-w-[90px]')}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // 2. Match Intro / VS Card
    if (overlay.layoutPreset === 'match_intro') {
      return (
        <div className={`flex min-h-screen items-center justify-center bg-transparent p-8 ${animClass}`}>
          <div className={`w-full max-w-3xl overflow-hidden rounded-3xl border ${surfaceClass}`}>
            <div className="p-7">
              <div className="mb-5 flex items-center justify-between text-xs font-extrabold uppercase tracking-widest text-amber-400">
                <span>{tournament?.name || settings.eventName}</span>
                <span>{match?.stageLabel || match?.courtName || 'NEXT MATCH'}</span>
              </div>
              <div className="grid grid-cols-3 items-center gap-4 text-center">
                <div className="flex flex-col items-center gap-2">
                  <TeamAvatar team={teamA} size="lg" />
                  <h2 className="font-display text-2xl font-extrabold uppercase">
                    {teamA?.name || 'Menunggu Tim A'}
                  </h2>
                  <p className={`text-xs ${mutedText}`}>{teamA?.school || ''}</p>
                </div>
                <div className="flex flex-col items-center">
                  <span className="rounded-2xl bg-amber-500 px-5 py-2 font-display text-3xl font-black text-slate-950">
                    VS
                  </span>
                  <p className={`mt-2 text-xs font-bold ${mutedText}`}>
                    {match?.scheduledAt || match?.courtName || ''}
                  </p>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <TeamAvatar team={teamB} size="lg" />
                  <h2 className="font-display text-2xl font-extrabold uppercase">
                    {teamB?.name || 'Menunggu Tim B'}
                  </h2>
                  <p className={`text-xs ${mutedText}`}>{teamB?.school || ''}</p>
                </div>
              </div>
            </div>
            {renderBrandSponsorBar()}
          </div>
        </div>
      );
    }

    // 3. Timeout / Set-Break Card
    if (overlay.layoutPreset === 'timeout_break') {
      return (
        <div className={`flex min-h-screen items-center justify-center bg-transparent p-8 ${animClass}`}>
          <div className={`w-full max-w-3xl overflow-hidden rounded-3xl border ${surfaceClass}`}>
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="rounded-full bg-amber-500 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-950">
                  {overlay.customBadgeText || 'TIME-OUT / JEDA SET'}
                </span>
                <span className={`text-xs font-bold ${mutedText}`}>
                  {tournament?.name} • {match?.courtName}
                </span>
              </div>
              <div className="grid grid-cols-3 items-center gap-3 text-center">
                <div className="flex flex-col items-center">
                  <TeamAvatar team={teamA} size="lg" />
                  <p className="mt-2 font-display text-lg font-extrabold uppercase">
                    {teamA?.name || 'Tim A'}
                  </p>
                </div>
                <div>
                  <div className="font-display text-5xl font-black tabular-nums text-amber-400">
                    {scoreA} : {scoreB}
                  </div>
                  <p className={`mt-1 text-xs font-bold uppercase ${mutedText}`}>
                    Set {match?.setsWonA ?? 0} - {match?.setsWonB ?? 0}
                  </p>
                </div>
                <div className="flex flex-col items-center">
                  <TeamAvatar team={teamB} size="lg" />
                  <p className="mt-2 font-display text-lg font-extrabold uppercase">
                    {teamB?.name || 'Tim B'}
                  </p>
                </div>
              </div>
              {overlay.showSetHistory && match && match.sets.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-center gap-2 border-t border-slate-500/20 pt-3">
                  {match.sets.map((s) => (
                    <span
                      key={s.setNumber}
                      className="rounded-lg bg-slate-500/15 px-3 py-1 text-xs font-bold tabular-nums"
                    >
                      Set {s.setNumber}: {s.scoreA}-{s.scoreB}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {renderBrandSponsorBar()}
          </div>
        </div>
      );
    }

    // 4. Winner Celebration Card
    if (overlay.layoutPreset === 'winner_card') {
      return (
        <div className={`flex min-h-screen items-end justify-center bg-transparent p-8 ${animClass}`}>
          <div className={`w-full max-w-3xl overflow-hidden rounded-3xl border border-amber-500/60 ${surfaceClass}`}>
            <div className="p-6 text-center">
              <div className="mx-auto mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-slate-950">
                <Trophy className="h-3.5 w-3.5" />
                Pemenang Pertandingan
              </div>
              <div className="mt-2 flex items-center justify-center gap-4">
                <TeamAvatar team={winnerTeam || teamA} size="lg" />
                <div className="text-left">
                  <h2 className="font-display text-3xl font-black uppercase text-amber-400">
                    {winnerTeam?.name || `${teamA?.name || 'Tim A'} vs ${teamB?.name || 'Tim B'}`}
                  </h2>
                  <p className={`text-sm font-bold ${mutedText}`}>
                    Skor Set Akhir: {match?.setsWonA ?? 0} - {match?.setsWonB ?? 0}
                  </p>
                </div>
              </div>
            </div>
            {renderBrandSponsorBar()}
          </div>
        </div>
      );
    }

    // 5. Lineup / Starting Roster Card
    if (overlay.layoutPreset === 'lineup_roster') {
      return (
        <div className={`flex min-h-screen items-center justify-center bg-transparent p-8 ${animClass}`}>
          <div className={`w-full max-w-4xl overflow-hidden rounded-3xl border ${surfaceClass}`}>
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between border-b border-slate-500/20 pb-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-slate-950">
                  <Users className="h-3.5 w-3.5" />
                  Starting Lineup &amp; Daftar Pemain
                </span>
                <span className={`text-xs font-bold ${mutedText}`}>
                  {tournament?.name} • {match?.stageLabel || match?.courtName}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {[
                  { team: teamA, roster: rosterA, label: 'Tim A' },
                  { team: teamB, roster: rosterB, label: 'Tim B' },
                ].map((side, idx) => (
                  <div key={idx} className="space-y-2.5">
                    <div className="flex items-center gap-2.5">
                      <TeamAvatar team={side.team} size="md" />
                      <div>
                        <h3 className="font-display text-lg font-extrabold uppercase">
                          {side.team?.name || side.label}
                        </h3>
                        {side.team?.coachName && (
                          <p className={`text-[11px] ${mutedText}`}>
                            Pelatih: {side.team.coachName}
                          </p>
                        )}
                      </div>
                    </div>
                    {side.roster.length === 0 ? (
                      <p className={`rounded-xl border border-dashed border-slate-500/30 p-4 text-center text-xs ${mutedText}`}>
                        Daftar pemain belum diinput di Back-Office.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        {side.roster.slice(0, 12).map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center gap-2 rounded-lg bg-slate-500/15 px-2.5 py-1.5 text-xs"
                          >
                            <span className="flex h-5 w-6 shrink-0 items-center justify-center rounded bg-amber-500 font-mono text-[11px] font-black text-slate-950">
                              {p.jerseyNumber}
                            </span>
                            <span className="truncate font-bold">{p.name}</span>
                            {p.role !== 'player' && (
                              <span className="ml-auto rounded bg-amber-500/20 px-1 text-[9px] font-extrabold uppercase text-amber-400">
                                {p.role === 'captain' ? 'C' : 'L'}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {renderBrandSponsorBar()}
          </div>
        </div>
      );
    }

    // 6. Standby / Starting Soon & Upcoming Schedule
    if (overlay.layoutPreset === 'standby_schedule') {
      return (
        <div className={`flex min-h-screen items-center justify-center bg-transparent p-8 ${animClass}`}>
          <div className={`w-full max-w-4xl overflow-hidden rounded-3xl border ${surfaceClass}`}>
            <div className="p-7">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-500/20 pb-5">
                <div className="flex items-center gap-4">
                  <img
                    src={settings.logoUrl || '/brand/svc-crest-color.svg'}
                    alt="Event"
                    className="h-14 w-14 object-contain"
                  />
                  <img
                    src={settings.organizerLogoUrl || '/brand/logo_smansage.png'}
                    alt="Penyelenggara"
                    className="h-12 w-12 object-contain"
                  />
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-950">
                      <CalendarClock className="h-3 w-3" />
                      {overlay.customBadgeText || 'SEGERA DIMULAI / JEDA SIARAN'}
                    </span>
                    <h2 className="mt-1 font-display text-2xl font-black uppercase">
                      {settings.eventName || 'Smansage Volleyball Competition'}
                    </h2>
                    <p className={`text-xs font-semibold ${mutedText}`}>
                      {settings.eventSubtitle}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-2.5">
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-amber-400">
                  Jadwal Pertandingan Berikutnya
                </p>
                {upcomingMatches.length === 0 ? (
                  <div className="rounded-2xl bg-slate-500/10 p-4 text-center text-sm font-bold">
                    {teamA?.name || 'Tim A'} vs {teamB?.name || 'Tim B'} —{' '}
                    {match?.scheduledAt || match?.courtName}
                  </div>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {upcomingMatches.map((um) => (
                      <div
                        key={um.id}
                        className="rounded-2xl border border-slate-500/20 bg-slate-500/10 p-3.5"
                      >
                        <p className="text-[10px] font-extrabold uppercase text-amber-400">
                          {um.stageLabel || um.courtName}
                        </p>
                        <p className="mt-1 text-sm font-extrabold">
                          {um.teamAName} <span className={mutedText}>vs</span> {um.teamBName}
                        </p>
                        <p className={`mt-1 text-[11px] ${mutedText}`}>
                          {um.scheduledAt || um.courtName}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {renderBrandSponsorBar()}
          </div>
        </div>
      );
    }

    // 7. Default: Lower-Third Broadcast Bar
    return (
      <div className={`flex min-h-screen items-end justify-center bg-transparent p-6 ${animClass}`}>
        <div className={`w-full max-w-5xl overflow-hidden rounded-2xl border ${surfaceClass}`}>
          <div className="flex items-center justify-between gap-4 px-5 py-3">
            {/* Team A */}
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <TeamAvatar team={teamA} size="md" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-display text-lg font-extrabold uppercase">
                    {teamA?.name || 'Tim A'}
                  </span>
                  {match?.status === 'live' && match?.servingTeam === 'A' && (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                  )}
                </div>
                {overlay.showTimeoutSub && (
                  <p className={`text-[11px] font-semibold ${mutedText}`}>
                    T/O {activeSet?.timeoutsA ?? 0}/2 • SUB {activeSet?.subsA ?? 0}/6
                  </p>
                )}
              </div>
            </div>

            {/* Center Score Box */}
            <div className="flex shrink-0 flex-col items-center rounded-xl bg-amber-500 px-5 py-1.5 text-slate-950">
              <span className="text-[10px] font-extrabold uppercase tracking-wider">
                {match ? `SET ${match.currentSet} (${match.setsWonA}-${match.setsWonB})` : 'STANDBY'}
              </span>
              <span className="font-display text-3xl font-black leading-none tabular-nums">
                {scoreA} : {scoreB}
              </span>
            </div>

            {/* Team B */}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-3 text-right">
              <div className="min-w-0">
                <div className="flex items-center justify-end gap-2">
                  {match?.status === 'live' && match?.servingTeam === 'B' && (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                  )}
                  <span className="truncate font-display text-lg font-extrabold uppercase">
                    {teamB?.name || 'Tim B'}
                  </span>
                </div>
                {overlay.showTimeoutSub && (
                  <p className={`text-[11px] font-semibold ${mutedText}`}>
                    T/O {activeSet?.timeoutsB ?? 0}/2 • SUB {activeSet?.subsB ?? 0}/6
                  </p>
                )}
              </div>
              <TeamAvatar team={teamB} size="md" />
            </div>
          </div>

          {overlay.showSetHistory && match && match.sets.length > 0 && (
            <div className="flex items-center gap-3 border-t border-slate-500/20 bg-slate-500/5 px-5 py-1 text-[11px] font-bold">
              <span className="uppercase text-amber-400">
                {overlay.customBadgeText || settings.eventName}
              </span>
              {match.sets.map((s) => (
                <span key={s.setNumber} className={mutedText}>
                  S{s.setNumber}: {s.scoreA}-{s.scoreB}
                </span>
              ))}
            </div>
          )}

          {renderBrandSponsorBar()}
        </div>
      </div>
    );
  };

  return (
    <>
      {renderPresetContent()}
      {renderStingerLayer()}
    </>
  );
}

import { ShieldAlert, Trophy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { TeamAvatar } from '../components/TeamAvatar';
import { apiFetch } from '../lib/api';
import type {
  Match,
  ObsOverlay,
  SiteSettings,
  SponsorItem,
  Team,
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

interface ObsStateResponse {
  overlay: Omit<ObsOverlay, 'accessToken'>;
  match: Match | null;
  teamA: Team | null;
  teamB: Team | null;
  tournament: Tournament | null;
  settings: SiteSettings;
}

export function ObsOverlayDisplay() {
  const [state, setState] = useState<ObsStateResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

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

    const poll = window.setInterval(loadObsState, 12000);
    return () => {
      es.close();
      window.clearInterval(poll);
    };
  }, [loadObsState, overlaySlug, token]);

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

  if (!state) {
    return <div className="min-h-screen bg-transparent" />;
  }

  const { overlay, match, teamA, teamB, tournament, settings } = state;
  if (!overlay.isVisible) {
    return <div className="min-h-screen bg-transparent" />;
  }

  const activeSet =
    match?.sets.find((s) => s.setNumber === match.currentSet) ??
    match?.sets[match.sets.length - 1];
  const scoreA = activeSet?.scoreA ?? 0;
  const scoreB = activeSet?.scoreB ?? 0;
  const sponsors = parseSponsorsList(settings.sponsorsJson);
  const topSponsor = sponsors[0];

  const surfaceClass =
    overlay.themeMode === 'light'
      ? 'border-slate-200/90 bg-white/95 text-slate-900 shadow-2xl'
      : overlay.themeMode === 'glass'
        ? 'border-white/25 bg-slate-950/65 text-white backdrop-blur-xl shadow-2xl'
        : 'border-slate-700/80 bg-slate-950/92 text-white shadow-2xl';

  const mutedText =
    overlay.themeMode === 'light' ? 'text-slate-500' : 'text-slate-300';

  const winnerTeam =
    match?.winnerId && teamA && match.winnerId === teamA.id
      ? teamA
      : match?.winnerId && teamB && match.winnerId === teamB.id
        ? teamB
        : null;

  // Variation 1: Scorebug Corner (Top-Left Compact Broadcast Pill)
  if (overlay.layoutPreset === 'scorebug_corner') {
    return (
      <div className="min-h-screen bg-transparent p-6">
        <div
          className={`inline-flex flex-col overflow-hidden rounded-2xl border ${surfaceClass}`}
        >
          <div className="flex items-center justify-between gap-4 border-b border-amber-500/25 bg-amber-500/15 px-3.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
            <span>{overlay.customBadgeText || settings.eventName}</span>
            <span>
              {match
                ? `SET ${match.currentSet} • ${match.courtName}`
                : 'STANDBY'}
            </span>
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
      </div>
    );
  }

  // Variation 3: Match Intro / VS Card
  if (overlay.layoutPreset === 'match_intro') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent p-8">
        <div className={`w-full max-w-3xl rounded-3xl border p-7 ${surfaceClass}`}>
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
      </div>
    );
  }

  // Variation 4: Timeout / Set-Break Card
  if (overlay.layoutPreset === 'timeout_break') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent p-8">
        <div className={`w-full max-w-2xl rounded-3xl border p-6 ${surfaceClass}`}>
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
      </div>
    );
  }

  // Variation 5: Winner Celebration Card
  if (overlay.layoutPreset === 'winner_card') {
    return (
      <div className="flex min-h-screen items-end justify-center bg-transparent p-8">
        <div
          className={`w-full max-w-2xl rounded-3xl border border-amber-500/60 p-6 text-center ${surfaceClass}`}
        >
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
      </div>
    );
  }

  // Variation 2 (Default): Lower-Third Broadcast Bar
  return (
    <div className="flex min-h-screen items-end justify-center bg-transparent p-6">
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

        {(overlay.showSetHistory || (overlay.showSponsorTicker && topSponsor)) && (
          <div className="flex items-center justify-between border-t border-slate-500/20 bg-slate-500/10 px-5 py-1.5 text-[11px] font-bold">
            <div className="flex items-center gap-2">
              <span className="uppercase text-amber-400">
                {overlay.customBadgeText || settings.eventName}
              </span>
              {overlay.showSetHistory &&
                match?.sets.map((s) => (
                  <span key={s.setNumber} className={mutedText}>
                    S{s.setNumber}: {s.scoreA}-{s.scoreB}
                  </span>
                ))}
            </div>
            {overlay.showSponsorTicker && topSponsor && (
              <span className={mutedText}>Partner: {topSponsor.name}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

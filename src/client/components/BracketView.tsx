import {
  Award,
  Crown,
  Maximize2,
  Medal,
  Minimize2,
  Move,
  RotateCcw,
  Trophy,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatRoundColumnLabel } from '../../shared/stages';
import type { Match, Team } from '../types';
import { TeamAvatar } from './TeamAvatar';

interface BracketViewProps {
  matches: Match[];
  teams: Team[];
  highlightedMatchId?: number | null;
  onSelectMatch?: (match: Match) => void;
}

type WingFilter = 'all' | 'left' | 'center' | 'right';

/**
 * Draws SVG bracket connector lines between N matches (left) and N/2 matches (right).
 */
function RoundConnector({
  pairCount,
  direction,
  activePairs,
}: {
  pairCount: number;
  direction: 'ltr' | 'rtl';
  activePairs: boolean[];
}) {
  return (
    <div className="hidden w-5 shrink-0 flex-col justify-around sm:flex" aria-hidden="true">
      {Array.from({ length: pairCount }).map((_, idx) => {
        const isGold = activePairs[idx];
        const stroke = isGold ? '#E09D17' : 'currentColor';
        const opacity = isGold ? 'opacity-90' : 'opacity-20';
        return (
          <div key={idx} className={`flex flex-1 items-center ${opacity}`}>
            <svg
              viewBox="0 0 24 100"
              preserveAspectRatio="none"
              className="h-1/2 w-full text-slate-400 dark:text-slate-600"
            >
              {direction === 'ltr' ? (
                <path
                  d="M0 0 H12 V50 H24 M0 100 H12 V50"
                  fill="none"
                  stroke={stroke}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <path
                  d="M24 0 H12 V50 H0 M24 100 H12 V50"
                  fill="none"
                  stroke={stroke}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

export function BracketView({
  matches,
  teams,
  highlightedMatchId,
  onSelectMatch,
}: BracketViewProps) {
  const [wingFilter, setWingFilter] = useState<WingFilter>('all');
  const [compact, setCompact] = useState(true);

  // Interactive Semi-3D Map Pan & Zoom state
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const fitToViewport = () => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }
    const vpW = vp.clientWidth;
    const ctW = ct.scrollWidth;
    const nextZoom = ctW > vpW ? Math.max(0.4, Math.min(1, (vpW - 24) / ctW)) : 1;
    setZoom(Number(nextZoom.toFixed(2)));
    setPan({ x: 0, y: 0 });
    setTilt({ rx: 0, ry: 0 });
  };

  useEffect(() => {
    const timer = setTimeout(fitToViewport, 60);
    return () => clearTimeout(timer);
  }, [wingFilter, compact, matches.length]);

  // Non-passive wheel listener so Ctrl/Cmd + Scroll & trackpad pinch zoom the bracket, not the browser page
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? -0.08 : 0.08;
        setZoom((z) => Math.max(0.35, Math.min(1.8, Number((z + factor).toFixed(2)))));
      }
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  const getPinchDist = () => {
    const pts = Array.from(pointersRef.current.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (pointersRef.current.size === 1) {
      setIsDragging(true);
      dragStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      pinchStartRef.current = null;
    } else if (pointersRef.current.size === 2) {
      setIsDragging(false);
      dragStartRef.current = null;
      setTilt({ rx: 0, ry: 0 });
      pinchStartRef.current = {
        dist: getPinchDist(),
        zoom: zoomRef.current,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const currentDist = getPinchDist();
      if (pinchStartRef.current.dist > 0) {
        const scale = currentDist / pinchStartRef.current.dist;
        const nextZoom = Math.max(
          0.35,
          Math.min(1.8, Number((pinchStartRef.current.zoom * scale).toFixed(2)))
        );
        setZoom(nextZoom);
      }
      return;
    }

    if (pointersRef.current.size === 1 && isDragging && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.pointerX;
      const dy = e.clientY - dragStartRef.current.pointerY;
      setPan({
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      });
      setTilt({
        rx: Math.max(-5, Math.min(5, -dy * 0.03)),
        ry: Math.max(-6, Math.min(6, dx * 0.03)),
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture already released
    }

    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      setIsDragging(false);
      dragStartRef.current = null;
      setTilt({ rx: 0, ry: 0 });
    }
  };

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const mainMatches = matches.filter((m) => m.bracketType === 'main');
  const thirdPlaceMatch = matches.find((m) => m.bracketType === 'third_place');

  if (mainMatches.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/50 p-10 text-center dark:border-slate-800 dark:bg-slate-900/40">
        <Trophy className="mx-auto mb-3 h-10 w-10 text-amber-500/60" />
        <p className="font-semibold text-slate-700 dark:text-slate-200">
          Bagan turnamen belum dibuat
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Panitia dapat membuat slot Undian (4 / 8 / 16 Tim) atau bagan otomatis dari Back-Office.
        </p>
      </div>
    );
  }

  const totalRounds = Math.max(...mainMatches.map((m) => m.round));
  const finalMatch = mainMatches.find((m) => m.round === totalRounds);

  const champion = finalMatch?.winnerId ? teamMap.get(finalMatch.winnerId) : null;
  const runnerUp =
    finalMatch?.winnerId && finalMatch.teamAId && finalMatch.teamBId
      ? teamMap.get(
          finalMatch.winnerId === finalMatch.teamAId
            ? finalMatch.teamBId
            : finalMatch.teamAId
        )
      : null;
  const thirdWinner = thirdPlaceMatch?.winnerId
    ? teamMap.get(thirdPlaceMatch.winnerId)
    : null;
  const fourthPlace =
    thirdPlaceMatch?.winnerId && thirdPlaceMatch.teamAId && thirdPlaceMatch.teamBId
      ? teamMap.get(
          thirdPlaceMatch.winnerId === thirdPlaceMatch.teamAId
            ? thirdPlaceMatch.teamBId
            : thirdPlaceMatch.teamAId
        )
      : null;

  const cardWidth = compact ? 'w-44 xl:w-48' : 'w-64';

  const renderMatchCard = (match: Match, badgeLabel?: string, delayIdx = 0) => {
    const teamA = match.teamAId ? teamMap.get(match.teamAId) : null;
    const teamB = match.teamBId ? teamMap.get(match.teamBId) : null;
    const stagePlaceholders = match.stageLabel?.includes(' vs ')
      ? match.stageLabel.split(' vs ')
      : [null, null];
    const placeholderA = stagePlaceholders[0] || 'TBD';
    const placeholderB = stagePlaceholders[1] || 'TBD';
    const isLive = match.status === 'live';
    const isFinished = match.status === 'finished';
    const isBye = match.status === 'bye';
    const activeSet = match.sets.find((s) => s.setNumber === match.currentSet);

    const isHighlighted = highlightedMatchId === match.id;

    const isInteractive = !isBye && Boolean(onSelectMatch);

    return (
      <div
        key={match.id}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={
          isInteractive
            ? `Rincian laga ${teamA?.name || 'Menunggu'} melawan ${teamB?.name || 'Menunggu'}`
            : undefined
        }
        onClick={() => {
          if (isInteractive && onSelectMatch) onSelectMatch(match);
        }}
        onKeyDown={(e) => {
          if (!isInteractive || !onSelectMatch) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectMatch(match);
          }
        }}
        style={{ animationDelay: `${delayIdx * 35}ms` }}
        className={`animate-bracket-card ${cardWidth} shrink-0 overflow-hidden rounded-xl border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${
          isInteractive ? 'cursor-pointer' : ''
        } ${
          isHighlighted
            ? 'border-sky-500 bg-white shadow-lg shadow-sky-500/20 ring-2 ring-sky-500 dark:bg-slate-900'
            : isLive
              ? 'border-amber-500 bg-white shadow-md shadow-amber-500/15 ring-1 ring-amber-500/40 dark:border-amber-400 dark:bg-slate-900'
              : isFinished
                ? 'border-amber-600/35 bg-white dark:border-amber-500/30 dark:bg-slate-900/95'
                : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90'
        }`}
      >
        <div className="flex items-center justify-between gap-1 border-b border-slate-100 bg-slate-50/90 px-2.5 py-1 text-[11px] font-bold dark:border-slate-800/80 dark:bg-slate-950/70">
          <span className="truncate text-slate-600 dark:text-slate-400">
            {badgeLabel || match.courtName}
          </span>
          {isLive && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              LIVE S{match.currentSet}
            </span>
          )}
          {isFinished && (
            <span className="shrink-0 uppercase tracking-wider text-amber-800 dark:text-amber-400">
              FINAL
            </span>
          )}
          {isBye && (
            <span className="shrink-0 uppercase tracking-wider text-slate-600 dark:text-slate-400">
              BYE
            </span>
          )}
        </div>

        {/* Team A */}
        <div
          className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 transition-colors ${
            match.winnerId && match.winnerId === match.teamAId
              ? 'bg-amber-500/12 font-bold dark:bg-amber-500/15'
              : ''
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="h-3.5 w-1 shrink-0 rounded-full"
              style={{ backgroundColor: teamA?.color || '#64748B' }}
            />
            {!compact && <TeamAvatar team={teamA} size="sm" />}
            <p
              title={teamA?.name || placeholderA}
              className={`truncate text-xs font-semibold ${
                teamA
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'italic text-slate-500 dark:text-slate-400'
              }`}
            >
              {teamA ? teamA.name : isBye ? 'BYE' : placeholderA}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 tabular-nums">
            {isLive && activeSet && (
              <span className="rounded bg-slate-100 px-1 py-0.5 text-[11px] font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                {activeSet.scoreA}
              </span>
            )}
            <span
              className={`min-w-[14px] text-right font-display text-sm font-bold ${
                match.winnerId === match.teamAId
                  ? 'text-amber-800 dark:text-amber-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {isBye ? (teamA ? 'W' : '-') : match.setsWonA}
            </span>
          </div>
        </div>

        <div className="h-px bg-slate-100 dark:bg-slate-800/80" />

        {/* Team B */}
        <div
          className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 transition-colors ${
            match.winnerId && match.winnerId === match.teamBId
              ? 'bg-amber-500/12 font-bold dark:bg-amber-500/15'
              : ''
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="h-3.5 w-1 shrink-0 rounded-full"
              style={{ backgroundColor: teamB?.color || '#64748B' }}
            />
            {!compact && <TeamAvatar team={teamB} size="sm" />}
            <p
              title={teamB?.name || placeholderB}
              className={`truncate text-xs font-semibold ${
                teamB
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'italic text-slate-500 dark:text-slate-400'
              }`}
            >
              {teamB ? teamB.name : isBye ? 'BYE' : placeholderB}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 tabular-nums">
            {isLive && activeSet && (
              <span className="rounded bg-slate-100 px-1 py-0.5 text-[11px] font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                {activeSet.scoreB}
              </span>
            )}
            <span
              className={`min-w-[14px] text-right font-display text-sm font-bold ${
                match.winnerId === match.teamBId
                  ? 'text-amber-800 dark:text-amber-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {isBye ? (teamB ? 'W' : '-') : match.setsWonB}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const preFinalRounds = Array.from({ length: Math.max(0, totalRounds - 1) }, (_, i) => i + 1);
  const rightRounds = [...preFinalRounds].reverse();

  return (
    <div className="space-y-4">
      {/* Wing Filter Pills + Compact/Detail Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {totalRounds >= 2 && (
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', 'All Brackets'],
                ['left', 'Left Bracket'],
                ['center', 'Finals Stage'],
                ['right', 'Right Bracket'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setWingFilter(key)}
                className={`min-h-11 rounded-full px-3.5 py-2 text-xs font-bold transition sm:min-h-8 sm:py-1.5 ${
                  wingFilter === key
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setCompact(!compact)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 transition hover:border-amber-600 sm:min-h-8 sm:py-1.5 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          {compact ? (
            <>
              <Maximize2 className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
              Detailed Cards
            </>
          ) : (
            <>
              <Minimize2 className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
              Compact View
            </>
          )}
        </button>
      </div>

      {/* Clear Legend & Instructions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-slate-200/80 bg-white/80 px-3.5 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Live Match
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
          Advancing Winner
        </span>
        <span className="text-slate-600 dark:text-slate-400">
          • Left Bracket &amp; Right Bracket converge at the Grand Final in the center.
        </span>
      </div>

      {/* Interactive Semi-3D Map-Like Pan & Zoom Viewport (No Scrollbars) */}
      <div
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/40 p-4 dark:border-slate-800/80 dark:bg-slate-950/50 ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        } touch-none select-none`}
        style={{ minHeight: '540px' }}
      >
        {/* Floating Map HUD Controls */}
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-xl border border-slate-200/90 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/95">
          <button
            type="button"
            aria-label="Perkecil bagan"
            title="Perkecil"
            onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.1).toFixed(2))))}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-700 transition hover:bg-amber-500/15 hover:text-amber-800 sm:min-h-8 sm:min-w-8 dark:text-slate-300 dark:hover:text-amber-400"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[44px] text-center text-xs font-bold tabular-nums text-slate-700 dark:text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Perbesar bagan"
            title="Perbesar"
            onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.1).toFixed(2))))}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-700 transition hover:bg-amber-500/15 hover:text-amber-800 sm:min-h-8 sm:min-w-8 dark:text-slate-300 dark:hover:text-amber-400"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <div className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <button
            type="button"
            title="Reset & Fit Layar"
            onClick={fitToViewport}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold text-amber-800 transition hover:bg-amber-500/15 sm:min-h-8 dark:text-amber-400"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Fit
          </button>
        </div>

        {/* Drag hint pill */}
        <div className="pointer-events-none absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/85 dark:text-slate-300">
          <Move className="h-3 w-3 text-amber-700 dark:text-amber-400" />
          Geser bagan seperti peta
        </div>

        {/* Semi-3D Transformed Bracket Canvas */}
        <div
          className="flex w-full items-center justify-center pt-6"
          style={{
            perspective: '1400px',
          }}
        >
          <div
            ref={contentRef}
            className={`flex w-max items-stretch gap-1 px-2 ${
              isDragging ? '' : 'transition-transform duration-300 ease-out'
            }`}
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom}) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
              transformOrigin: 'center center',
            }}
          >
          {/* LEFT BRACKET (LEFT -> CENTER) */}
          {(wingFilter === 'all' || wingFilter === 'left') &&
            preFinalRounds.map((round, rIdx) => {
              const allInRound = mainMatches
                .filter((m) => m.round === round)
                .sort((a, b) => a.matchIndex - b.matchIndex);
              const half = Math.ceil(allInRound.length / 2);
              const poolAMatches = allInRound.slice(0, half);
              const hasNextRoundInPool = rIdx < preFinalRounds.length - 1;

              const activePairs: boolean[] = [];
              for (let i = 0; i < poolAMatches.length; i += 2) {
                const m1 = poolAMatches[i];
                const m2 = poolAMatches[i + 1];
                activePairs.push(
                  Boolean(
                    m1?.status === 'finished' ||
                      m2?.status === 'finished' ||
                      m1?.status === 'live' ||
                      m2?.status === 'live'
                  )
                );
              }

              return (
                <div key={`A-${round}`} className="flex items-stretch">
                  <div className="flex flex-col">
                    <div className="sport-skew mb-3 flex items-center justify-between rounded bg-slate-900 px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-400 dark:bg-slate-800">
                      <span className="sport-unskew truncate">
                        {formatRoundColumnLabel(round, totalRounds, 'L')}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col justify-around gap-3">
                      {poolAMatches.map((m, idx) =>
                        renderMatchCard(m, `${m.courtName}`, idx)
                      )}
                    </div>
                  </div>
                  {hasNextRoundInPool && (
                    <div className="flex flex-col pt-9">
                      <div className="flex flex-1">
                        <RoundConnector
                          pairCount={Math.max(1, Math.floor(poolAMatches.length / 2))}
                          direction="ltr"
                          activePairs={activePairs}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

          {/* CENTER: FINALS STAGE & PODIUM */}
          {(wingFilter === 'all' || wingFilter === 'center') && (
            <div className="flex flex-col items-center justify-center gap-3 px-2 sm:px-3">
              <div
                className={`${cardWidth} inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-600 via-amber-500 to-amber-400 px-3 py-1.5 text-center text-xs font-extrabold uppercase tracking-widest text-slate-950 shadow-md shadow-amber-500/20`}
              >
                <Crown className="h-3.5 w-3.5 shrink-0" />
                <span>Finals Stage</span>
              </div>

              {/* Champion Card */}
              <div
                className={`animate-bracket-card ${cardWidth} rounded-xl border border-amber-500/60 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/40 p-3 text-center text-white shadow-lg shadow-amber-500/10`}
              >
                <Crown className="mx-auto h-5 w-5 text-amber-400" />
                <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-amber-300">
                  1st Place • Champion
                </p>
                <p className="mt-0.5 truncate font-display text-base font-extrabold uppercase">
                  {champion ? champion.name : '[ TBD Champion ]'}
                </p>
              </div>

              {finalMatch && renderMatchCard(finalMatch, 'GRAND FINAL')}

              {thirdPlaceMatch &&
                renderMatchCard(thirdPlaceMatch, '3RD PLACE MATCH', 2)}

              {/* Podium Recap */}
              <div
                className={`${cardWidth} space-y-1.5 rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-800 dark:bg-slate-900/90`}
              >
                <p className="mb-1.5 flex items-center gap-1.5 font-display text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                  <Award className="h-3.5 w-3.5" />
                  Official Podium
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex shrink-0 items-center gap-1 font-semibold text-amber-800 dark:text-amber-400">
                    <Medal className="h-3 w-3" /> 1st
                  </span>
                  <span className="truncate font-bold">{champion?.name || '-'}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex shrink-0 items-center gap-1 font-semibold text-slate-600 dark:text-slate-400">
                    <Medal className="h-3 w-3" /> 2nd
                  </span>
                  <span className="truncate font-semibold">{runnerUp?.name || '-'}</span>
                </div>
                {thirdPlaceMatch && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex shrink-0 items-center gap-1 font-semibold text-amber-800 dark:text-amber-500">
                        <Medal className="h-3 w-3" /> 3rd
                      </span>
                      <span className="truncate font-semibold">{thirdWinner?.name || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="shrink-0 font-semibold text-slate-600 dark:text-slate-400">
                        4th
                      </span>
                      <span className="truncate text-slate-600 dark:text-slate-400">
                        {fourthPlace?.name || '-'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* RIGHT BRACKET (CENTER <- RIGHT MIRRORED) */}
          {(wingFilter === 'all' || wingFilter === 'right') &&
            rightRounds.map((round, rIdx) => {
              const allInRound = mainMatches
                .filter((m) => m.round === round)
                .sort((a, b) => a.matchIndex - b.matchIndex);
              const half = Math.ceil(allInRound.length / 2);
              const poolBMatches = allInRound.slice(half);
              const hasPrevRoundInPool = rIdx > 0;

              const activePairs: boolean[] = [];
              for (let i = 0; i < poolBMatches.length; i += 2) {
                const m1 = poolBMatches[i];
                const m2 = poolBMatches[i + 1];
                activePairs.push(
                  Boolean(
                    m1?.status === 'finished' ||
                      m2?.status === 'finished' ||
                      m1?.status === 'live' ||
                      m2?.status === 'live'
                  )
                );
              }

              return (
                <div key={`B-${round}`} className="flex items-stretch">
                  {!hasPrevRoundInPool ? null : (
                    <div className="flex flex-col pt-9">
                      <div className="flex flex-1">
                        <RoundConnector
                          pairCount={Math.max(1, Math.floor(poolBMatches.length / 2))}
                          direction="rtl"
                          activePairs={activePairs}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col">
                    <div className="sport-skew mb-3 flex items-center justify-between rounded bg-slate-900 px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-wider text-sky-400 dark:bg-slate-800">
                      <span className="sport-unskew truncate">
                        {formatRoundColumnLabel(round, totalRounds, 'R')}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col justify-around gap-3">
                      {poolBMatches.map((m, idx) =>
                        renderMatchCard(m, `${m.courtName}`, idx)
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

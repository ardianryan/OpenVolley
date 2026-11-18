import { ArrowRight, GitBranch, Monitor, Trophy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createVolleyballTextures } from '../lib/volleyball3d';
import type { Match, Team } from '../types';
import { ShinyText } from './reactbits/ShinyText';
import { TeamAvatar } from './TeamAvatar';
import { VolleyballIcon } from './VolleyballIcon';

interface VolleyballArena3DProps {
  logoUrl?: string;
  eventName: string;
  eventSubtitle: string;
  eventMeta: string;
  categoryName?: string;
  teamCount?: number;
  liveCount: number;
  finishedCount?: number;
  featuredMatch?: Match | null;
  featuredTeamA?: Team | null;
  featuredTeamB?: Team | null;
  onOpenBracket?: () => void;
  onSelectMatch?: (matchId: number) => void;
}

export function VolleyballArena3D({
  logoUrl,
  eventName,
  eventSubtitle,
  eventMeta,
  categoryName,
  teamCount = 0,
  liveCount,
  finishedCount = 0,
  featuredMatch,
  featuredTeamA,
  featuredTeamB,
  onOpenBracket,
  onSelectMatch,
}: VolleyballArena3DProps) {
  const stageRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentParallaxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const stageEl = stageRef.current;
    if (!container || !stageEl) return;

    let animationFrameId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let isVisible = true;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    try {
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x060913, 0.038);

      const width = container.clientWidth || 1080;
      const height = container.clientHeight || 340;

      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
      const baseCamPos = { x: 0.4, y: 4.55, z: 9.4 };
      camera.position.set(baseCamPos.x, baseCamPos.y, baseCamPos.z);
      camera.lookAt(0.25, 0.55, 0);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      // Stadium Broadcast Lighting
      const ambient = new THREE.AmbientLight(0xdbeafe, 0.6);
      scene.add(ambient);

      const centerSpot = new THREE.PointLight(0xf5c538, 28, 34);
      centerSpot.position.set(0.2, 5.6, 1.4);
      scene.add(centerSpot);

      const leftRim = new THREE.DirectionalLight(0x38bdf8, 1.35);
      leftRim.position.set(-8, 6.5, -4);
      scene.add(leftRim);

      const rightRim = new THREE.DirectionalLight(0xf59e0b, 1.2);
      rightRim.position.set(8, 5.5, 3);
      scene.add(rightRim);

      // Root Arena Group for multi-layer 3D parallax
      const arenaGroup = new THREE.Group();
      arenaGroup.position.x = 0.35;
      scene.add(arenaGroup);

      // 1. Outer Arena Apron (Obsidian Navy)
      const apronGeo = new THREE.PlaneGeometry(16.5, 10.6);
      const apronMat = new THREE.MeshStandardMaterial({
        color: 0x080c15,
        roughness: 0.85,
        metalness: 0.15,
      });
      const apron = new THREE.Mesh(apronGeo, apronMat);
      apron.rotation.x = -Math.PI / 2;
      apron.position.y = -0.02;
      arenaGroup.add(apron);

      // 2. Inner Taraflex Volleyball Court (9m x 18m scaled -> 11.2 x 5.8)
      const courtW = 11.2;
      const courtD = 5.8;
      const courtGeo = new THREE.PlaneGeometry(courtW, courtD);
      const courtMat = new THREE.MeshStandardMaterial({
        color: 0x152542,
        roughness: 0.5,
        metalness: 0.22,
      });
      const court = new THREE.Mesh(courtGeo, courtMat);
      court.rotation.x = -Math.PI / 2;
      arenaGroup.add(court);

      // Warm hardwood / front-zone accent inside 3m attack area
      const frontZoneGeo = new THREE.PlaneGeometry(3.7, courtD - 0.06);
      const frontZoneMat = new THREE.MeshStandardMaterial({
        color: 0x1d3258,
        roughness: 0.46,
        metalness: 0.24,
      });
      const frontZone = new THREE.Mesh(frontZoneGeo, frontZoneMat);
      frontZone.rotation.x = -Math.PI / 2;
      frontZone.position.y = 0.005;
      arenaGroup.add(frontZone);

      // Court Metallic Gold Lines
      const lineMat = new THREE.LineBasicMaterial({
        color: 0xf5c538,
        transparent: true,
        opacity: 0.92,
      });
      const addLine = (pts: THREE.Vector3[]) => {
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        arenaGroup.add(new THREE.Line(geo, lineMat));
      };

      const hw = courtW / 2;
      const hd = courtD / 2;
      // Outer boundary
      addLine([
        new THREE.Vector3(-hw, 0.015, -hd),
        new THREE.Vector3(hw, 0.015, -hd),
        new THREE.Vector3(hw, 0.015, hd),
        new THREE.Vector3(-hw, 0.015, hd),
        new THREE.Vector3(-hw, 0.015, -hd),
      ]);
      // Center line & 3m Attack lines
      addLine([new THREE.Vector3(0, 0.015, -hd), new THREE.Vector3(0, 0.015, hd)]);
      addLine([new THREE.Vector3(-1.86, 0.015, -hd), new THREE.Vector3(-1.86, 0.015, hd)]);
      addLine([new THREE.Vector3(1.86, 0.015, -hd), new THREE.Vector3(1.86, 0.015, hd)]);
      // Service zone hash ticks
      for (const side of [-1, 1]) {
        addLine([
          new THREE.Vector3(side * (hw + 0.15), 0.015, -hd),
          new THREE.Vector3(side * (hw + 0.45), 0.015, -hd),
        ]);
        addLine([
          new THREE.Vector3(side * (hw + 0.15), 0.015, hd),
          new THREE.Vector3(side * (hw + 0.45), 0.015, hd),
        ]);
      }

      // 3. Pro Volleyball Net + Posts + Antennas
      const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.95, 12);
      const postMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.82,
        roughness: 0.24,
      });
      for (const zPos of [-hd - 0.28, hd + 0.28]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(0, 0.96, zPos);
        arenaGroup.add(post);
      }

      // Antennas (crimson/white tournament markers)
      const antGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8);
      const antMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0x991b1b,
        emissiveIntensity: 0.45,
      });
      for (const zPos of [-hd, hd]) {
        const ant = new THREE.Mesh(antGeo, antMat);
        ant.position.set(0, 1.72, zPos);
        arenaGroup.add(ant);
      }

      // Net mesh
      const netGeo = new THREE.PlaneGeometry(courtD, 1.0, 24, 7);
      const netMat = new THREE.MeshBasicMaterial({
        color: 0xf8fafc,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
      });
      const net = new THREE.Mesh(netGeo, netMat);
      net.rotation.y = Math.PI / 2;
      net.position.y = 1.14;
      arenaGroup.add(net);

      // Gold top & bottom net tapes
      const tapeGeo = new THREE.BoxGeometry(0.065, 0.075, courtD + 0.16);
      const tapeMat = new THREE.MeshStandardMaterial({
        color: 0xf5c538,
        emissive: 0xd48911,
        emissiveIntensity: 0.48,
      });
      const topTape = new THREE.Mesh(tapeGeo, tapeMat);
      topTape.position.y = 1.64;
      arenaGroup.add(topTape);

      const botTape = new THREE.Mesh(tapeGeo, tapeMat);
      botTape.position.y = 0.64;
      arenaGroup.add(botTape);

      // 4. Floating 3D Pro Volleyball (18-panel spherical projection + inflated leather bumpMap)
      const ballGroup = new THREE.Group();
      arenaGroup.add(ballGroup);

      const ballTextures = createVolleyballTextures(512, 256);
      const ballGeo = new THREE.SphereGeometry(0.6, 48, 36);
      const ballMat = new THREE.MeshStandardMaterial({
        map: ballTextures.colorMap,
        bumpMap: ballTextures.bumpMap,
        bumpScale: 0.035,
        roughness: 0.32,
        metalness: 0.08,
      });
      ballGroup.add(new THREE.Mesh(ballGeo, ballMat));
      ballGroup.position.set(0.4, 2.35, 0.25);

      // 5. Dual-Depth Parallax Golden Arena Particles
      const createParticles = (count: number, size: number, spreadZ: number) => {
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 18;
          positions[i * 3 + 1] = Math.random() * 5.4;
          positions[i * 3 + 2] = (Math.random() - 0.5) * spreadZ;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
          color: 0xf5c538,
          size,
          transparent: true,
          opacity: 0.6,
        });
        return { geo, points: new THREE.Points(geo, mat) };
      };

      const bgParticles = createParticles(50, 0.05, 10);
      const fgParticles = createParticles(32, 0.085, 5);
      scene.add(bgParticles.points);
      scene.add(fgParticles.points);

      // Multi-layer Pointer + Scroll Parallax State
      let targetPtrX = 0;
      let targetPtrY = 0;
      let currentPtrX = 0;
      let currentPtrY = 0;
      let targetScrollRatio = 0;
      let currentScrollRatio = 0;

      const onPointerMove = (e: PointerEvent) => {
        if (prefersReducedMotion) return;
        const rect = stageEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        targetPtrX = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
        targetPtrY = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
      };

      const onScroll = () => {
        if (prefersReducedMotion) return;
        targetScrollRatio = Math.max(0, Math.min(1, window.scrollY / 460));
      };

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('scroll', onScroll, { passive: true });

      const ro = new ResizeObserver(() => {
        if (!renderer) return;
        const w = container.clientWidth || 1080;
        const h = container.clientHeight || 340;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (prefersReducedMotion) {
          renderer.render(scene, camera);
        }
      });
      ro.observe(container);

      const io = new IntersectionObserver(
        (entries) => {
          isVisible = entries[0]?.isIntersecting ?? true;
        },
        { threshold: 0.02 }
      );
      io.observe(stageEl);

      // Render static composed frame immediately if reduced motion is enabled
      if (prefersReducedMotion) {
        renderer.render(scene, camera);
      } else {
        const clock = new THREE.Clock();
        const animate = () => {
          animationFrameId = requestAnimationFrame(animate);
          if (!isVisible) return;

          const t = clock.getElapsedTime();

          // Smooth damped pointer & scroll interpolation
          currentPtrX += (targetPtrX - currentPtrX) * 0.055;
          currentPtrY += (targetPtrY - currentPtrY) * 0.055;
          currentScrollRatio += (targetScrollRatio - currentScrollRatio) * 0.08;

          if (contentParallaxRef.current) {
            const shiftY = currentScrollRatio * -10;
            contentParallaxRef.current.style.transform = `translate3d(0, ${shiftY.toFixed(1)}px, 0)`;
          }

          const idleX = Math.sin(t * 0.32) * 0.22;
          camera.position.x = baseCamPos.x + currentPtrX * 0.8 + idleX;
          camera.position.y = baseCamPos.y - currentPtrY * 0.42 - currentScrollRatio * 0.85;
          camera.position.z = baseCamPos.z - currentScrollRatio * 1.05;
          camera.lookAt(0.25, 0.58 - currentScrollRatio * 0.22, 0);

          arenaGroup.rotation.y = currentPtrX * 0.075;
          arenaGroup.rotation.x = currentPtrY * 0.035;

          // Parabolic rally arc over the net with realistic topspin
          const rallyX = Math.sin(t * 0.82) * 2.35;
          const rallyY = 2.05 + Math.abs(Math.cos(t * 0.82)) * 0.9;
          const rallyZ = Math.cos(t * 0.56) * 0.65;
          ballGroup.position.set(rallyX, rallyY, rallyZ);
          ballGroup.rotation.set(t * 1.4, t * 1.1, -Math.cos(t * 0.82) * 0.6);

          bgParticles.points.position.x = -currentPtrX * 0.35;
          fgParticles.points.position.x = -currentPtrX * 0.9;

          for (const layer of [
            { geo: bgParticles.geo, speed: 0.0038 },
            { geo: fgParticles.geo, speed: 0.0075 },
          ]) {
            const posAttr = layer.geo.getAttribute('position') as THREE.BufferAttribute;
            for (let i = 0; i < posAttr.count; i++) {
              let py = posAttr.getY(i) + layer.speed;
              if (py > 5.4) py = 0;
              posAttr.setY(i, py);
            }
            posAttr.needsUpdate = true;
          }

          renderer?.render(scene, camera);
        };
        animate();
      }

      return () => {
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('scroll', onScroll);
        ro.disconnect();
        io.disconnect();
        ballTextures.colorMap.dispose();
        ballTextures.bumpMap.dispose();
        ballGeo.dispose();
        ballMat.dispose();
        if (renderer && renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
        renderer?.dispose();
      };
    } catch {
      return undefined;
    }
  }, []);

  const isFeaturedLive = featuredMatch?.status === 'live';
  const isFeaturedFinished = featuredMatch?.status === 'finished';
  const activeSet = featuredMatch?.sets.find((s) => s.setNumber === featuredMatch.currentSet);

  return (
    <section
      ref={stageRef}
      aria-label="Pusat Pertandingan Bola Voli"
      className="animate-page-enter relative mb-6 overflow-hidden rounded-3xl border border-amber-500/35 bg-slate-950 text-white shadow-2xl"
    >
      {/* Full-Bleed 3D Volleyball Sport Center Canvas */}
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      />

      {/* Atmospheric Readability Scrims (Preserves Center 3D Court Visibility) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950/92 via-slate-950/58 to-slate-950/88"
      />
      <div
        aria-hidden="true"
        className="sport-diagonal-bg pointer-events-none absolute inset-0 opacity-50"
      />

      {/* Foreground 2-Zone Matchday Sport Center Layout */}
      <div
        ref={contentParallaxRef}
        className="relative z-10 grid min-h-[290px] items-center gap-5 p-5 transition-transform duration-150 ease-out sm:min-h-[330px] sm:p-7 lg:min-h-[356px] lg:grid-cols-[1.2fr_0.95fr] lg:gap-8 lg:p-8"
      >
        {/* Left Zone: Official Crest, Stadium Identity, Quick Stats & Primary CTAs */}
        <div className="flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {liveCount > 0 ? (
              <span className="sport-skew inline-flex items-center gap-1.5 rounded bg-red-600 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-white shadow-md shadow-red-600/25">
                <span className="sport-unskew inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  {liveCount} Lapangan Sedang Live
                </span>
              </span>
            ) : (
              <span className="sport-skew inline-flex items-center gap-1.5 rounded bg-amber-500 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-slate-950">
                <span className="sport-unskew">Matchday Sport Center</span>
              </span>
            )}

            {categoryName && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-slate-900/80 px-3 py-1 text-xs font-bold text-amber-300 backdrop-blur-xs">
                <Trophy className="h-3.5 w-3.5 text-amber-400" />
                {categoryName}
              </span>
            )}
          </div>

          <div className="flex items-start gap-3.5 sm:items-center sm:gap-5">
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Logo Resmi Kompetisi"
                className="h-16 w-16 shrink-0 object-contain drop-shadow-[0_0_22px_rgba(245,197,56,0.45)] sm:h-22 sm:w-22"
              />
            )}
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-extrabold uppercase leading-[1.03] tracking-wide text-white sm:text-4xl lg:text-[2.65rem]">
                {eventName}
              </h2>
              <p className="mt-1.5 text-xs font-medium leading-relaxed text-slate-200 sm:text-sm">
                {eventSubtitle} •{' '}
                <ShinyText className="font-extrabold">{eventMeta}</ShinyText>
              </p>
            </div>
          </div>

          {/* Arena Summary Pills + Primary Action Buttons (>= 44px touch targets) */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {onOpenBracket && (
              <button
                type="button"
                onClick={onOpenBracket}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-slate-950 shadow-lg shadow-amber-500/25 transition hover:bg-amber-400"
              >
                <GitBranch className="h-4 w-4" />
                Bagan Turnamen
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}

            <a
              href="/tv"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-2.5 text-xs font-bold text-slate-100 backdrop-blur-xs transition hover:border-amber-400/60 hover:text-amber-300"
            >
              <Monitor className="h-4 w-4 text-amber-400" />
              Layar Skor TV
            </a>

            {teamCount > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-800/90 bg-slate-950/70 px-3.5 py-2 text-xs text-slate-300 backdrop-blur-xs">
                <span className="font-bold text-amber-300 tabular-nums">{teamCount}</span> Tim
                <span className="text-slate-600">•</span>
                <span className="font-bold text-emerald-400 tabular-nums">{finishedCount}</span>{' '}
                Selesai
              </div>
            )}
          </div>
        </div>

        {/* Right Zone: Featured Live / Next Match Scoreboard Card */}
        {featuredMatch ? (
          <button
            type="button"
            onClick={() => onSelectMatch?.(featuredMatch.id)}
            aria-label={`Buka rincian pertandingan ${featuredTeamA?.name || 'Tim A'} melawan ${
              featuredTeamB?.name || 'Tim B'
            }`}
            className="group relative w-full overflow-hidden rounded-2xl border border-amber-400/35 bg-slate-900/85 p-4 text-left shadow-xl backdrop-blur-md transition duration-300 hover:-translate-y-0.5 hover:border-amber-400/75 hover:bg-slate-900/95 sm:p-5"
          >
            {/* Card Header */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="sport-skew inline-block rounded bg-amber-500 px-2 py-0.5 text-[11px] font-extrabold uppercase text-slate-950">
                  <span className="sport-unskew">{featuredMatch.courtName}</span>
                </span>
                <span className="font-bold uppercase tracking-wider text-slate-300">
                  {featuredMatch.bracketType === 'third_place'
                    ? 'Perebutan Juara 3'
                    : `Babak ${featuredMatch.round}`}
                </span>
              </div>

              {isFeaturedLive ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  LIVE • SET {featuredMatch.currentSet}
                </span>
              ) : isFeaturedFinished ? (
                <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
                  SELESAI
                </span>
              ) : (
                <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-[11px] font-bold text-sky-300">
                  {featuredMatch.scheduledAt || 'Laga Berikutnya'}
                </span>
              )}
            </div>

            {/* Teams & Scoreboard Row */}
            <div className="mt-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
              {/* Team A */}
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  <TeamAvatar team={featuredTeamA} size="md" />
                  {isFeaturedLive && featuredMatch.servingTeam === 'A' && (
                    <span
                      title="Sedang Servis"
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow"
                    >
                      <VolleyballIcon className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-extrabold uppercase leading-snug text-white sm:text-sm">
                  {featuredTeamA?.name || 'Menunggu'}
                </p>
                {featuredTeamA?.school && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">
                    {featuredTeamA.school}
                  </p>
                )}
              </div>

              {/* Center Live / Scheduled / Finished Score */}
              <div className="flex flex-col items-center px-1">
                {isFeaturedLive && activeSet ? (
                  <>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                      Poin Set {featuredMatch.currentSet}
                    </span>
                    <div className="mt-0.5 flex items-center gap-1.5 font-display text-4xl font-extrabold leading-none tabular-nums text-white sm:text-5xl">
                      <span
                        className={
                          featuredMatch.servingTeam === 'A' ? 'text-amber-400' : 'text-white'
                        }
                      >
                        {activeSet.scoreA}
                      </span>
                      <span className="text-lg text-slate-500">:</span>
                      <span
                        className={
                          featuredMatch.servingTeam === 'B' ? 'text-amber-400' : 'text-white'
                        }
                      >
                        {activeSet.scoreB}
                      </span>
                    </div>
                    <span className="mt-1.5 rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-300">
                      Set {featuredMatch.setsWonA} - {featuredMatch.setsWonB}
                    </span>
                  </>
                ) : isFeaturedFinished ? (
                  <>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Skor Akhir Set
                    </span>
                    <div className="mt-0.5 flex items-center gap-2 font-display text-3xl font-extrabold tabular-nums sm:text-4xl">
                      <span
                        className={
                          featuredMatch.winnerId === featuredMatch.teamAId
                            ? 'text-amber-400'
                            : 'text-slate-200'
                        }
                      >
                        {featuredMatch.setsWonA}
                      </span>
                      <span className="text-base text-slate-500">-</span>
                      <span
                        className={
                          featuredMatch.winnerId === featuredMatch.teamBId
                            ? 'text-amber-400'
                            : 'text-slate-200'
                        }
                      >
                        {featuredMatch.setsWonB}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-400/40 bg-amber-500/15 font-display text-lg font-extrabold tracking-wider text-amber-300">
                      VS
                    </span>
                    <span className="mt-1.5 text-[11px] font-semibold text-slate-400">
                      Siap Bertanding
                    </span>
                  </div>
                )}
              </div>

              {/* Team B */}
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  <TeamAvatar team={featuredTeamB} size="md" />
                  {isFeaturedLive && featuredMatch.servingTeam === 'B' && (
                    <span
                      title="Sedang Servis"
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow"
                    >
                      <VolleyballIcon className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-extrabold uppercase leading-snug text-white sm:text-sm">
                  {featuredTeamB?.name || 'Menunggu'}
                </p>
                {featuredTeamB?.school && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">
                    {featuredTeamB.school}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3.5 flex items-center justify-between border-t border-slate-800/90 pt-2.5 text-[11px] font-semibold text-slate-300">
              <span>Ketuk papan skor untuk rincian set &amp; dokumentasi</span>
              <span className="inline-flex items-center gap-1 font-bold text-amber-300 group-hover:translate-x-0.5 transition-transform">
                Match Center
                <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </button>
        ) : (
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/75 p-5 text-center backdrop-blur-md">
            <VolleyballIcon className="mx-auto h-9 w-9 text-amber-400" />
            <p className="mt-2 font-display text-lg font-extrabold uppercase tracking-wide text-white">
              Arena Siap Digelar
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Jadwal pertandingan dan skor real-time kategori ini akan tampil otomatis di sini.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

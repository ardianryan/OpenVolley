import {
  ArrowRightLeft,
  Camera,
  Eye,
  EyeOff,
  Link2,
  PlugZap,
  ShieldAlert,
  Sparkles,
  Tv2,
  Unplug,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import {
  ObsWebSocketClient,
  type ObsSceneInfo,
  type ObsTransitionInfo,
} from '../lib/obsWebSocket';
import type {
  ObsLayoutPreset,
  ObsOverlay,
  ObsSceneMapping,
  ObsTransitionPreset,
} from '../types';

const PRESET_BUTTONS: Array<{ id: ObsLayoutPreset; short: string }> = [
  { id: 'lower_third', short: 'Lower-Third' },
  { id: 'scorebug_corner', short: 'Scorebug' },
  { id: 'match_intro', short: 'Intro VS' },
  { id: 'lineup_roster', short: 'Lineup' },
  { id: 'timeout_break', short: 'Timeout/Break' },
  { id: 'standby_schedule', short: 'Starting Soon' },
  { id: 'winner_card', short: 'Winner' },
];

const TRANSITION_OPTIONS: Array<{ id: ObsTransitionPreset; label: string }> = [
  { id: 'broadcast_wipe', label: 'Broadcast Wipe' },
  { id: 'slide_edge', label: 'Slide Edge' },
  { id: 'zoom_pop', label: 'Zoom Pop' },
  { id: 'fade_smooth', label: 'Fade Smooth' },
  { id: 'cut', label: 'Cut (Instan)' },
];

function parseSceneMapping(raw?: string): ObsSceneMapping {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ObsSceneMapping;
  } catch {
    return {};
  }
}

export function ObsDockPanel() {
  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const overlaySlug = params.get('overlay')?.trim() || '';
  const token = params.get('token')?.trim() || '';

  const [overlay, setOverlay] = useState<Omit<ObsOverlay, 'accessToken'> | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Local OBS WebSocket v5 state
  const wsRef = useRef<ObsWebSocketClient | null>(null);
  const [wsUrl, setWsUrl] = useState(
    () => localStorage.getItem('ov_obs_ws_url') || 'ws://127.0.0.1:4455'
  );
  const [wsPass, setWsPass] = useState(
    () => localStorage.getItem('ov_obs_ws_pass') || ''
  );
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [scenes, setScenes] = useState<ObsSceneInfo[]>([]);
  const [transitions, setTransitions] = useState<ObsTransitionInfo[]>([]);
  const [currentScene, setCurrentScene] = useState('');
  const [autoSyncScenes, setAutoSyncScenes] = useState(true);

  // Anti-loop timestamp guard between OpenVolley <-> OBS Scene changes
  const suppressObsEventUntilRef = useRef<number>(0);

  const flash = (msg: string) => {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 2500);
  };

  const sceneMapping = useMemo(
    () => parseSceneMapping(overlay?.sceneMappingJson),
    [overlay?.sceneMappingJson]
  );

  const loadState = useCallback(async () => {
    if (!token) {
      setAuthError('Token OBS tidak ditemukan (?token=...).');
      return;
    }
    try {
      const qs = new URLSearchParams({ token });
      if (overlaySlug) qs.set('overlay', overlaySlug);
      const res = await apiFetch<{ overlay: Omit<ObsOverlay, 'accessToken'> }>(
        `/api/public/obs-state?${qs.toString()}&_=${Date.now()}`,
        { cache: 'no-store' }
      );
      setAuthError(null);
      setOverlay(res.overlay);
    } catch (err) {
      setAuthError((err as Error).message || 'Akses ditolak');
    }
  }, [overlaySlug, token]);

  useEffect(() => {
    void loadState();
    if (!token) return;
    const qs = new URLSearchParams({ token });
    if (overlaySlug) qs.set('overlay', overlaySlug);
    const es = new EventSource(`/api/public/obs-stream?${qs.toString()}`);
    es.addEventListener('obs_overlay_updated', () => void loadState());
    return () => es.close();
  }, [loadState, overlaySlug, token]);

  const sendDockControl = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!token) return;
      const qs = new URLSearchParams({ token });
      if (overlaySlug) qs.set('overlay', overlaySlug);
      const res = await apiFetch<{ overlay?: Omit<ObsOverlay, 'accessToken'> }>(
        `/api/public/obs-dock-control?${qs.toString()}`,
        { method: 'POST', body: JSON.stringify(payload) }
      );
      if (res.overlay) setOverlay(res.overlay);
    },
    [overlaySlug, token]
  );

  // Listen to OBS CurrentProgramSceneChanged -> Sync OpenVolley Preset (OBS -> OpenVolley)
  useEffect(() => {
    if (!wsRef.current || !wsConnected) return;
    return wsRef.current.onSceneChanged((newSceneName) => {
      setCurrentScene(newSceneName);
      if (!autoSyncScenes || Date.now() < suppressObsEventUntilRef.current) return;

      const matchedPreset = (Object.entries(sceneMapping) as Array<
        [ObsLayoutPreset, { obsSceneName?: string }]
      >).find(([, cfg]) => cfg?.obsSceneName === newSceneName)?.[0];

      if (matchedPreset && overlay && matchedPreset !== overlay.layoutPreset) {
        void sendDockControl({ layoutPreset: matchedPreset });
        flash(`Auto-Preset: ${matchedPreset} (dari Scene "${newSceneName}")`);
      }
    });
  }, [wsConnected, autoSyncScenes, sceneMapping, overlay, sendDockControl]);

  const handleConnectObs = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setWsError(null);
    localStorage.setItem('ov_obs_ws_url', wsUrl);
    localStorage.setItem('ov_obs_ws_pass', wsPass);

    const client = wsRef.current || new ObsWebSocketClient();
    wsRef.current = client;

    client.onClose(() => {
      setWsConnected(false);
    });

    try {
      await client.connect(wsUrl.trim(), wsPass);
      const [sceneRes, transRes] = await Promise.all([
        client.getSceneList(),
        client.getTransitionList(),
      ]);
      setScenes(sceneRes.scenes);
      setCurrentScene(sceneRes.currentProgramSceneName);
      setTransitions(transRes.transitions);
      setWsConnected(true);
      flash('Terhubung ke OBS Studio WebSocket v5!');
    } catch (err) {
      setWsConnected(false);
      setWsError((err as Error).message);
    }
  };

  const handleDisconnectObs = () => {
    wsRef.current?.disconnect();
    setWsConnected(false);
  };

  const handleSelectPreset = async (preset: ObsLayoutPreset) => {
    await sendDockControl({ layoutPreset: preset });
    flash(`Preset diubah ke ${preset}`);

    // OpenVolley -> OBS Scene Mapping
    if (wsConnected && wsRef.current && autoSyncScenes) {
      const mapping = sceneMapping[preset];
      if (mapping?.obsTransitionName) {
        await wsRef.current.setCurrentTransition(mapping.obsTransitionName).catch(() => {});
      }
      if (mapping?.obsSceneName && mapping.obsSceneName !== currentScene) {
        suppressObsEventUntilRef.current = Date.now() + 1200;
        await wsRef.current.setCurrentScene(mapping.obsSceneName).catch(() => {});
        setCurrentScene(mapping.obsSceneName);
      }
    }
  };

  const handleSwitchObsScene = async (sceneName: string, withStinger: boolean) => {
    if (!wsRef.current || !wsConnected) return;
    if (withStinger) {
      await sendDockControl({ triggerStinger: true, stingerLabel: sceneName });
      suppressObsEventUntilRef.current = Date.now() + 1400;
      window.setTimeout(async () => {
        await wsRef.current?.setCurrentScene(sceneName).catch(() => {});
        setCurrentScene(sceneName);
      }, 430);
      flash(`Pindah ke "${sceneName}" di balik Stinger Bumper!`);
    } else {
      await wsRef.current.setCurrentScene(sceneName);
      setCurrentScene(sceneName);
      flash(`Scene aktif: ${sceneName}`);
    }
  };

  const handleAutoSetupObs = async () => {
    if (!wsRef.current || !wsConnected || !overlay) return;
    const origin = window.location.origin;
    const overlayUrl = `${origin}/obs?overlay=${encodeURIComponent(overlay.slug)}&token=${encodeURIComponent(token)}`;
    const targetScenes = scenes.map((s) => s.sceneName);
    if (targetScenes.length === 0) {
      setWsError('Tidak ada Scene ditemukan di OBS.');
      return;
    }
    try {
      const res = await wsRef.current.setupBrowserSourceAcrossScenes(
        `OpenVolley Overlay (${overlay.slug})`,
        overlayUrl,
        targetScenes
      );
      flash(
        `${res.created ? 'Source dibuat &' : 'Source diperbarui &'} dipasang ke ${targetScenes.length} Scene (1920x1080 60FPS)!`
      );
    } catch (err) {
      setWsError((err as Error).message);
    }
  };

  if (authError) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 text-white">
        <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs">
          <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="font-bold text-red-300">OBS Dock Error</p>
            <p className="text-slate-300">{authError}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-3 bg-slate-950 p-3 text-xs text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Tv2 className="h-4 w-4 text-amber-400" />
          <span className="font-display text-sm font-extrabold uppercase tracking-wider">
            OpenVolley Dock
          </span>
        </div>
        {overlay && (
          <button
            type="button"
            onClick={() => void sendDockControl({ isVisible: !overlay.isVisible })}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold ${
              overlay.isVisible
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {overlay.isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {overlay.isVisible ? 'Tampil' : 'Sembunyi'}
          </button>
        )}
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300">
          {statusMsg}
        </div>
      )}

      {/* Overlay Presets */}
      {overlay && (
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Preset Grafis ({overlay.name})
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_BUTTONS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void handleSelectPreset(p.id)}
                className={`rounded-lg px-2 py-1.5 text-left text-[11px] font-bold transition ${
                  overlay.layoutPreset === p.id
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {p.short}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <select
              value={overlay.transitionPreset || 'broadcast_wipe'}
              onChange={(e) =>
                void sendDockControl({ transitionPreset: e.target.value })
              }
              aria-label="Transisi Overlay"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-bold text-slate-200"
            >
              {TRANSITION_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() =>
                void sendDockControl({
                  triggerStinger: true,
                  stingerLabel: overlay.customBadgeText || 'LIVE BROADCAST',
                })
              }
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-500/20 px-2 py-1 text-[11px] font-extrabold text-amber-300 hover:bg-amber-500 hover:text-slate-950"
            >
              <Zap className="h-3 w-3" />
              Stinger Bumper
            </button>
          </div>
        </div>
      )}

      {/* OBS WebSocket v5 Bridge */}
      <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            <PlugZap className="h-3.5 w-3.5 text-amber-400" />
            OBS WebSocket v5
          </span>
          {wsConnected ? (
            <button
              type="button"
              onClick={handleDisconnectObs}
              className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300"
            >
              <Unplug className="h-3 w-3" /> Putus
            </button>
          ) : null}
        </div>

        {wsError && (
          <p className="rounded bg-red-500/15 px-2 py-1 text-[10px] text-red-300">
            {wsError}
          </p>
        )}

        {!wsConnected ? (
          <form onSubmit={handleConnectObs} className="space-y-1.5">
            <input
              type="text"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="ws://127.0.0.1:4455"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-[11px]"
            />
            <input
              type="password"
              value={wsPass}
              onChange={(e) => setWsPass(e.target.value)}
              placeholder="Password OBS WebSocket (opsional)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px]"
            />
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-extrabold text-slate-950 hover:bg-amber-400"
            >
              <Link2 className="h-3.5 w-3.5" />
              Hubungkan ke OBS Studio
            </button>
          </form>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                <input
                  type="checkbox"
                  checked={autoSyncScenes}
                  onChange={(e) => setAutoSyncScenes(e.target.checked)}
                />
                Sinkronisasi 2-Arah Scene
              </label>

              <button
                type="button"
                onClick={handleAutoSetupObs}
                title="Buat/Update Browser Source 1920x1080 di semua Scene OBS"
                className="inline-flex items-center gap-1 rounded-lg bg-sky-500/20 px-2 py-1 text-[10px] font-extrabold text-sky-300 hover:bg-sky-500 hover:text-slate-950"
              >
                <Sparkles className="h-3 w-3" />
                1-Klik Setup
              </button>
            </div>

            {transitions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <ArrowRightLeft className="h-3 w-3 shrink-0 text-slate-400" />
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      void wsRef.current?.setCurrentTransition(e.target.value);
                    }
                  }}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px]"
                >
                  <option value="">-- Transisi OBS Asli --</option>
                  {transitions.map((tr) => (
                    <option key={tr.transitionName} value={tr.transitionName}>
                      {tr.transitionName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase text-slate-400">
                Scene Kamera OBS ({scenes.length})
              </p>
              <div className="max-h-44 space-y-1 overflow-y-auto pr-0.5">
                {scenes.map((sc) => {
                  const isActive = sc.sceneName === currentScene;
                  return (
                    <div key={sc.sceneName} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleSwitchObsScene(sc.sceneName, false)}
                        className={`flex flex-1 items-center gap-1.5 truncate rounded-lg px-2 py-1.5 text-left text-[11px] font-bold ${
                          isActive
                            ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                            : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                        }`}
                      >
                        <Camera className="h-3 w-3 shrink-0" />
                        <span className="truncate">{sc.sceneName}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSwitchObsScene(sc.sceneName, true)}
                        title={`Pindah ke "${sc.sceneName}" + Stinger Bumper`}
                        className="rounded-lg bg-amber-500/15 p-1.5 text-amber-300 hover:bg-amber-500 hover:text-slate-950"
                      >
                        <Zap className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

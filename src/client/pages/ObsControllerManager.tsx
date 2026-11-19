import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  LayoutTemplate,
  MonitorPlay,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
  Tv2,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { apiFetch } from '../lib/api';
import type {
  ObsLayoutPreset,
  ObsOverlay,
  ObsSceneMapping,
  ObsThemeMode,
  ObsTransitionPreset,
  OverviewData,
} from '../types';

interface ObsControllerManagerProps {
  data: OverviewData;
}

const LAYOUT_PRESETS: Array<{
  id: ObsLayoutPreset;
  label: string;
  desc: string;
}> = [
  { id: 'lower_third', label: 'Lower-Third Broadcast', desc: 'Bar bawah penuh dengan logo acara, skor & sponsor' },
  { id: 'scorebug_corner', label: 'Scorebug Corner', desc: 'Pill skor kiri atas + Corner Brand & Sponsor Bug kanan atas' },
  { id: 'match_intro', label: 'Match Intro / VS Card', desc: 'Kartu perkenalan kedua tim sebelum laga' },
  { id: 'lineup_roster', label: 'Lineup / Starting Roster', desc: 'Daftar pemain & nomor punggung kedua tim' },
  { id: 'timeout_break', label: 'Timeout / Set-Break', desc: 'Kartu papan skor penuh saat jeda set/TO' },
  { id: 'standby_schedule', label: 'Starting Soon / Jeda', desc: 'Layar tunggu menampilkan jadwal berikutnya & sponsor penuh' },
  { id: 'winner_card', label: 'Winner Celebration', desc: 'Kartu pemenang akhir setelah pertandingan selesai' },
];

const TRANSITION_PRESETS: Array<{
  id: ObsTransitionPreset;
  label: string;
}> = [
  { id: 'broadcast_wipe', label: 'Broadcast Wipe (Rekomendasi TV)' },
  { id: 'slide_edge', label: 'Slide Edge (Geser Halus)' },
  { id: 'zoom_pop', label: 'Zoom Pop (Cepat & Tegas)' },
  { id: 'fade_smooth', label: 'Fade Smooth (Lembut)' },
  { id: 'cut', label: 'Cut (Langsung Tanpa Animasi)' },
];

export function ObsControllerManager({ data }: ObsControllerManagerProps) {
  const [overlays, setOverlays] = useState<ObsOverlay[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newCustomToken, setNewCustomToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedDockUrl, setCopiedDockUrl] = useState(false);
  const [stingerLabel, setStingerLabel] = useState('REPLAY / HIGHLIGHT');
  const [showPreview, setShowPreview] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState<ObsOverlay | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ObsOverlay | null>(null);

  const loadOverlays = useCallback(async () => {
    try {
      const res = await apiFetch<{ overlays: ObsOverlay[] }>('/api/admin/obs-overlays');
      setOverlays(res.overlays);
      setSelectedId((prev) =>
        prev && res.overlays.some((o) => o.id === prev)
          ? prev
          : res.overlays[0]?.id ?? null
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverlays();
  }, [loadOverlays]);

  const activeOverlay = overlays.find((o) => o.id === selectedId) ?? overlays[0] ?? null;

  const flash = (msg: string) => {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 2500);
  };

  const buildObsUrl = (ov: ObsOverlay) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/obs?overlay=${encodeURIComponent(ov.slug)}&token=${encodeURIComponent(ov.accessToken)}`;
  };

  const buildDockUrl = (ov: ObsOverlay) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/obs-dock?overlay=${encodeURIComponent(ov.slug)}&token=${encodeURIComponent(ov.accessToken)}`;
  };

  const triggerStinger = async (label?: string) => {
    if (!activeOverlay) return;
    await apiFetch(`/api/admin/obs-overlays/${activeOverlay.id}/stinger`, {
      method: 'POST',
      body: JSON.stringify({ label: label || stingerLabel || 'LIVE BROADCAST' }),
    });
    flash('Stinger Bumper diputar di OBS!');
  };

  const parsedSceneMapping: ObsSceneMapping = (() => {
    if (!activeOverlay?.sceneMappingJson) return {};
    try {
      return JSON.parse(activeOverlay.sceneMappingJson) as ObsSceneMapping;
    } catch {
      return {};
    }
  })();

  const handleUpdateSceneMapping = (
    preset: ObsLayoutPreset,
    field: 'obsSceneName' | 'obsTransitionName',
    value: string
  ) => {
    const next: ObsSceneMapping = {
      ...parsedSceneMapping,
      [preset]: {
        ...(parsedSceneMapping[preset] || {}),
        [field]: value,
      },
    };
    void patchOverlay({ sceneMappingJson: JSON.stringify(next) });
  };

  const patchOverlay = async (patch: Partial<ObsOverlay>) => {
    if (!activeOverlay) return;
    const res = await apiFetch<{ overlay: ObsOverlay }>(
      `/api/admin/obs-overlays/${activeOverlay.id}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    );
    setOverlays((prev) => prev.map((o) => (o.id === res.overlay.id ? res.overlay : o)));
    flash('Perubahan dikirim ke OBS secara real-time');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await apiFetch<{ overlay: ObsOverlay }>('/api/admin/obs-overlays', {
      method: 'POST',
      body: JSON.stringify({
        name: newName.trim(),
        accessToken: newCustomToken.trim() || undefined,
      }),
    });
    setNewName('');
    setNewCustomToken('');
    setOverlays((prev) => [...prev, res.overlay]);
    setSelectedId(res.overlay.id);
    flash('Profil OBS baru dibuat');
  };

  const handleRegenToken = async (ov: ObsOverlay) => {
    const res = await apiFetch<{ overlay: ObsOverlay }>(
      `/api/admin/obs-overlays/${ov.id}/regenerate-token`,
      { method: 'POST' }
    );
    setOverlays((prev) => prev.map((o) => (o.id === res.overlay.id ? res.overlay : o)));
    setConfirmRegen(null);
    flash('Token baru dibuat; URL lama otomatis tidak berlaku');
  };

  const handleDelete = async (ov: ObsOverlay) => {
    await apiFetch(`/api/admin/obs-overlays/${ov.id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    await loadOverlays();
    flash('Profil OBS dihapus');
  };

  const teamsMap = new Map(data.teams.map((t) => [t.id, t]));

  return (
    <div className="space-y-5">
      {statusMsg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}

      {/* Create & Switch OBS Profiles */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-extrabold uppercase tracking-wide">
              OBS Browser Source &amp; Remote Controller
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Setiap link OBS dilindungi token unik (?token=...) dan dikontrol langsung via SSE.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {overlays.map((ov) => (
              <button
                key={ov.id}
                type="button"
                onClick={() => setSelectedId(ov.id)}
                className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
                  activeOverlay?.id === ov.id
                    ? 'border-amber-500 bg-amber-500 text-slate-950'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-amber-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                }`}
              >
                <Tv2 className="h-3.5 w-3.5" />
                {ov.name}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleCreate} className="mt-4 grid gap-2.5 border-t border-slate-100 pt-4 dark:border-slate-800 sm:grid-cols-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nama Profil (misal: Kamera Utama)"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            type="text"
            value={newCustomToken}
            onChange={(e) => setNewCustomToken(e.target.value)}
            placeholder="Token/PIN kustom (opsional, min 6 karakter)"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950"
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah Profil OBS
          </button>
        </form>
      </div>

      {!loading && activeOverlay && (
        <div className="grid gap-5 lg:grid-cols-3">
          {/* Left: Security Link & Visibility */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                <KeyRound className="h-3.5 w-3.5 text-amber-500" />
                Link OBS Bertoken
              </span>
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="text-xs font-bold text-amber-600 dark:text-amber-400"
              >
                {showToken ? 'Sembunyikan' : 'Tampilkan Token'}
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] break-all dark:border-slate-800 dark:bg-slate-950">
              {showToken
                ? buildObsUrl(activeOverlay)
                : `${typeof window !== 'undefined' ? window.location.origin : ''}/obs?overlay=${activeOverlay.slug}&token=••••••••••••`}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(buildObsUrl(activeOverlay));
                  setCopiedUrl(true);
                  window.setTimeout(() => setCopiedUrl(false), 1800);
                }}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedUrl ? 'Tersalin' : 'Salin URL OBS'}
              </button>
              <a
                href={buildObsUrl(activeOverlay)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold hover:border-amber-400 dark:border-slate-700"
              >
                Preview
              </a>
              <button
                type="button"
                onClick={() => setConfirmRegen(activeOverlay)}
                title="Buat Ulang Token"
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold hover:border-amber-400 dark:border-slate-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              {overlays.length > 1 && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(activeOverlay)}
                  title="Hapus Profil"
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-500/10 dark:border-red-900/50 dark:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => patchOverlay({ isVisible: !activeOverlay.isVisible })}
              className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-extrabold uppercase tracking-wider transition ${
                activeOverlay.isVisible
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {activeOverlay.isVisible ? (
                <>
                  <Eye className="h-4 w-4" /> Overlay Tampil di OBS
                </>
              ) : (
                <>
                  <EyeOff className="h-4 w-4" /> Overlay Disembunyikan
                </>
              )}
            </button>

            {/* Stinger Bumper Trigger */}
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  <Zap className="h-3.5 w-3.5" /> Stinger Transition Bumper
                </span>
              </div>
              <input
                type="text"
                value={stingerLabel}
                onChange={(e) => setStingerLabel(e.target.value)}
                placeholder="Label Bumper (mis: REPLAY / JEDA)"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
              />
              <div className="flex flex-wrap gap-1">
                {['REPLAY / HIGHLIGHT', 'PERPINDAHAN KAMERA', 'JEDA PERTANDINGAN'].map((lbl) => (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => {
                      setStingerLabel(lbl);
                      void triggerStinger(lbl);
                    }}
                    className="rounded-md bg-white px-2 py-1 text-[10px] font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-amber-500 hover:text-slate-950 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void triggerStinger()}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-extrabold uppercase tracking-wider text-slate-950 hover:bg-amber-400"
              >
                <Zap className="h-4 w-4" />
                Putar Stinger Bumper (1.2s)
              </button>
            </div>

            {/* Plug & Play OBS Integration (Dock URL + Lua Plugin) */}
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  <PlugZap className="h-3.5 w-3.5 text-sky-500" />
                  OBS Plug &amp; Play Plugin
                </span>
                <button
                  type="button"
                  onClick={() => setShowGuide(!showGuide)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:underline dark:text-amber-400"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  {showGuide ? 'Tutup Panduan' : 'Cara Pasang'}
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(buildDockUrl(activeOverlay));
                    setCopiedDockUrl(true);
                    window.setTimeout(() => setCopiedDockUrl(false), 2000);
                  }}
                  className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:border-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {copiedDockUrl ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-500" /> URL Dock Disalin
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Salin URL Custom Browser Dock
                    </>
                  )}
                </button>

                <a
                  href={`/api/admin/obs-overlays/${activeOverlay.id}/lua-script`}
                  download
                  className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-extrabold text-sky-700 hover:bg-sky-500 hover:text-slate-950 dark:text-sky-300"
                >
                  <Download className="h-3.5 w-3.5" />
                  Unduh Script Plugin OBS (.lua)
                </a>
              </div>

              {showGuide && (
                <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  <li>
                    <strong>Cara Termudah (Dock + WebSocket):</strong> Di OBS Studio, buka{' '}
                    <em>Docks → Custom Browser Docks</em>, tempel URL Dock di atas, lalu hubungkan ke{' '}
                    <code>ws://127.0.0.1:4455</code> (pastikan <em>Tools → WebSocket Server</em> aktif). Klik{' '}
                    <strong>1-Klik Setup</strong> untuk otomatis membuat Browser Source 1920×1080 60FPS!
                  </li>
                  <li>
                    <strong>Alternatif Script Lua:</strong> Unduh file <code>.lua</code> di atas, lalu di OBS buka{' '}
                    <em>Tools → Scripts → (+)</em> dan pilih file tersebut untuk membuat source &amp; hotkey instan.
                  </li>
                  <li>
                    <strong>Penting:</strong> Pastikan opsi <em>Shutdown source when not visible</em> dalam keadaan{' '}
                    <strong>nonaktif (uncheck)</strong> agar animasi transisi tidak berkedip.
                  </li>
                </ol>
              )}
            </div>
          </div>

          {/* Right: Layout Variations, Transition Presets & Live Mini Preview */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                <LayoutTemplate className="h-3.5 w-3.5 text-amber-500" />
                Pilih Variasi Overlay ({LAYOUT_PRESETS.length} Preset Siaran)
              </h3>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                {LAYOUT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => patchOverlay({ layoutPreset: preset.id })}
                    className={`rounded-xl border p-3 text-left transition ${
                      activeOverlay.layoutPreset === preset.id
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-slate-200 hover:border-amber-400 dark:border-slate-800'
                    }`}
                  >
                    <p className="text-xs font-extrabold text-slate-900 dark:text-white">
                      {preset.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {preset.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 border-t border-slate-100 pt-4 dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                  Preset Transisi
                </label>
                <select
                  value={activeOverlay.transitionPreset || 'broadcast_wipe'}
                  onChange={(e) =>
                    patchOverlay({ transitionPreset: e.target.value as ObsTransitionPreset })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                >
                  {TRANSITION_PRESETS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                  Tema Visual
                </label>
                <select
                  value={activeOverlay.themeMode}
                  onChange={(e) =>
                    patchOverlay({ themeMode: e.target.value as ObsThemeMode })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="dark">Broadcast Dark</option>
                  <option value="light">Clean Light</option>
                  <option value="glass">Translucent Glass</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                  Target Lapangan
                </label>
                <select
                  value={activeOverlay.courtName}
                  onChange={(e) => patchOverlay({ courtName: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">Semua Lapangan (Auto)</option>
                  {(data.masterCourts ?? []).map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase text-slate-500">
                  Kunci Pertandingan
                </label>
                <select
                  value={activeOverlay.matchId ?? ''}
                  onChange={(e) =>
                    patchOverlay({
                      matchId: e.target.value ? Number(e.target.value) : null,
                      autoFollowCourt: !e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">Ikuti Match LIVE Otomatis</option>
                  {data.matches
                    .filter((m) => m.teamAId || m.teamBId)
                    .map((m) => {
                      const tA = m.teamAId ? teamsMap.get(m.teamAId)?.name : 'TBA';
                      const tB = m.teamBId ? teamsMap.get(m.teamBId)?.name : 'TBA';
                      return (
                        <option key={m.id} value={m.id}>
                          #{m.id} {tA} vs {tB} ({m.status})
                        </option>
                      );
                    })}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-xs">
              <label className="inline-flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={activeOverlay.showBrandBug !== false}
                  onChange={(e) =>
                    patchOverlay({ showBrandBug: e.target.checked })
                  }
                />
                Logo Acara &amp; Penyelenggara
              </label>
              <label className="inline-flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={activeOverlay.showSponsorTicker}
                  onChange={(e) =>
                    patchOverlay({ showSponsorTicker: e.target.checked })
                  }
                />
                Sponsor &amp; Media Partner
              </label>
              <label className="inline-flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={activeOverlay.showSetHistory}
                  onChange={(e) => patchOverlay({ showSetHistory: e.target.checked })}
                />
                Riwayat Skor Set
              </label>
              <label className="inline-flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={activeOverlay.showTimeoutSub}
                  onChange={(e) => patchOverlay({ showTimeoutSub: e.target.checked })}
                />
                Badge Time-Out &amp; Sub
              </label>
            </div>

            {/* Scene Mapping 2-Arah */}
            <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Pemetaan Scene Kamera OBS (Opsional — Sinkronisasi 2-Arah di Dock)
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Isi nama Scene OBS (harus persis seperti di OBS, misal: <code>Kamera Utama</code>,{' '}
                <code>Scene Jeda</code>) agar perpindahan Scene kamera &amp; preset berjalan otomatis.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {LAYOUT_PRESETS.map((preset) => {
                  const curMap = parsedSceneMapping[preset.id] || {};
                  return (
                    <div
                      key={preset.id}
                      className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/50"
                    >
                      <span className="w-32 shrink-0 truncate font-bold text-slate-700 dark:text-slate-200">
                        {preset.label}
                      </span>
                      <input
                        type="text"
                        defaultValue={curMap.obsSceneName || ''}
                        placeholder="Nama Scene OBS"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (curMap.obsSceneName || '')) {
                            handleUpdateSceneMapping(preset.id, 'obsSceneName', v);
                          }
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Mini Preview */}
            <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  <MonitorPlay className="h-3.5 w-3.5 text-amber-500" />
                  Live Mini Preview (Simulasi 16:9 di Atas Video Lapangan)
                </h4>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-xs font-bold text-amber-600 hover:underline dark:text-amber-400"
                >
                  {showPreview ? 'Sembunyikan Preview' : 'Tampilkan Preview'}
                </button>
              </div>
              {showPreview && (
                <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-300 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-700 via-slate-800 to-slate-950 dark:border-slate-700">
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-15">
                    <span className="font-display text-2xl font-black uppercase tracking-widest text-white">
                      CAMERA FEED SIMULATION (1920×1080)
                    </span>
                  </div>
                  <iframe
                    src={buildObsUrl(activeOverlay)}
                    title="OBS Live Mini Preview"
                    className="h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-transparent"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmRegen)}
        title="Buat Ulang Token OBS?"
        message="URL OBS lama yang memakai token sebelumnya akan langsung ditolak (403). Anda harus memperbarui URL di OBS Studio."
        confirmLabel="Buat Token Baru"
        variant="warning"
        onCancel={() => setConfirmRegen(null)}
        onConfirm={() => confirmRegen && void handleRegenToken(confirmRegen)}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Hapus Profil OBS?"
        message={`Hapus profil "${confirmDelete?.name}" secara permanen?`}
        confirmLabel="Hapus"
        variant="danger"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void handleDelete(confirmDelete)}
      />
    </div>
  );
}

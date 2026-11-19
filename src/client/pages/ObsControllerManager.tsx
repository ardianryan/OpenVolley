import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LayoutTemplate,
  Plus,
  RefreshCw,
  Trash2,
  Tv2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { apiFetch } from '../lib/api';
import type {
  ObsLayoutPreset,
  ObsOverlay,
  ObsThemeMode,
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
  { id: 'lower_third', label: 'Lower-Third Broadcast', desc: 'Bar bawah penuh dengan logo, skor & sponsor' },
  { id: 'scorebug_corner', label: 'Scorebug Corner', desc: 'Pill skor ringkas di sudut kiri atas siaran' },
  { id: 'match_intro', label: 'Match Intro / VS Card', desc: 'Kartu perkenalan kedua tim sebelum laga' },
  { id: 'timeout_break', label: 'Timeout / Set-Break', desc: 'Kartu papan skor penuh saat jeda set/TO' },
  { id: 'winner_card', label: 'Winner Celebration', desc: 'Kartu pemenang akhir setelah pertandingan selesai' },
];

export function ObsControllerManager({ data }: ObsControllerManagerProps) {
  const [overlays, setOverlays] = useState<ObsOverlay[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newCustomToken, setNewCustomToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
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
          </div>

          {/* Right: 5 Layout Variations & Broadcast Controls */}
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                <LayoutTemplate className="h-3.5 w-3.5 text-amber-500" />
                Pilih Variasi Overlay (5 Preset)
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

            <div className="grid gap-3 border-t border-slate-100 pt-4 dark:border-slate-800 sm:grid-cols-3">
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
                  Target Lapangan (Auto-Live)
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
                  Atau Kunci ke Pertandingan
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
                  checked={activeOverlay.showSponsorTicker}
                  onChange={(e) =>
                    patchOverlay({ showSponsorTicker: e.target.checked })
                  }
                />
                Tampilkan Sponsor
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

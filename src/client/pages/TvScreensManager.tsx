import {
  Check,
  Columns2,
  Copy,
  ExternalLink,
  GitBranch,
  ImagePlus,
  LayoutTemplate,
  Monitor,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { apiFetch } from '../lib/api';
import {
  IMAGE_INPUT_ACCEPT,
  normalizeImageInBrowser,
} from '../lib/mediaConverter';
import type {
  MasterCourt,
  Match,
  OverviewData,
  Team,
  TvBannerPreset,
  TvScreen,
  TvScreenMode,
} from '../types';

interface TvScreensManagerProps {
  data: OverviewData;
  onRefresh: () => Promise<void>;
}

const MODE_OPTIONS: Array<{
  value: TvScreenMode;
  label: string;
  icon: typeof Monitor;
}> = [
  { value: 'single', label: '1 Lapangan', icon: Monitor },
  { value: 'split', label: 'Split 2', icon: Columns2 },
  { value: 'auto_rotate', label: 'Auto 12d', icon: RefreshCw },
  { value: 'bracket', label: 'Bagan / TM', icon: GitBranch },
  { value: 'standby', label: 'Standby Banner', icon: LayoutTemplate },
];

const BANNER_PRESET_DEFAULTS: Record<
  TvBannerPreset,
  { label: string; badge: string; title: string; subtitle: string; notice: string }
> = {
  tm: {
    label: 'Technical Meeting',
    badge: 'STANDBY TM',
    title: 'TECHNICAL MEETING & DRAWING',
    subtitle: 'Mohon Perwakilan Tim & Official Memasuki Ruang Pertemuan',
    notice:
      'Siapkan daftar nama pemain, kostum bertanding, dan cek jadwal pada proyektor bagan undian resmi.',
  },
  warmup: {
    label: 'Warm-Up Tim',
    badge: 'WARM-UP ARENA',
    title: 'SESI PEMANASAN TIM',
    subtitle: 'Pertandingan Segera Dimulai, Harap Tim Bersiap',
    notice:
      'Pemanasan lapangan resmi sesuai aba-aba wasit. Kapten dan pelatih harap melapor ke meja pertandingan.',
  },
  break: {
    label: 'Istirahat / Jeda',
    badge: 'ISTIRAHAT',
    title: 'JEDA PERTANDINGAN',
    subtitle: 'Sesi Berikutnya Akan Segera Berlanjut di Arena Utama',
    notice:
      'Terima kasih telah menjaga kebersihan arena & menjunjung tinggi sportivitas turnamen.',
  },
  upcoming: {
    label: 'Next Match',
    badge: 'UPCOMING MATCH',
    title: 'PERTANDINGAN BERIKUTNYA',
    subtitle: 'Nantikan Duel Seru di Lapangan Sesuai Jadwal Resmi',
    notice:
      'Pantau live score, klasemen pool, dan bagan resmi melalui portal OpenVolley.',
  },
  custom: {
    label: 'Kustom Bebas',
    badge: 'PENGUMUMAN',
    title: 'SELAMAT DATANG DI ARENA',
    subtitle: 'Smansage Volleyball Competition',
    notice: 'Pengumuman resmi panitia pelaksana.',
  },
};

export function TvScreensManager({ data, onRefresh }: TvScreensManagerProps) {
  const [newName, setNewName] = useState('');
  const [newCourtId, setNewCourtId] = useState<string>('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingDeleteScreen, setPendingDeleteScreen] = useState<TvScreen | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Partial<TvScreen>>>({});
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null
  );

  const screens: TvScreen[] = data.tvScreens ?? [];
  const courts: MasterCourt[] = data.masterCourts ?? [];
  const teamMap = useMemo(
    () => new Map<number, Team>((data.teams ?? []).map((t) => [t.id, t])),
    [data.teams]
  );
  const playableMatches: Match[] = useMemo(
    () =>
      (data.matches ?? []).filter(
        (m) => m.status !== 'bye' && (m.teamAId || m.teamBId)
      ),
    [data.matches]
  );

  const notify = (type: 'ok' | 'err', msg: string) => {
    setFeedback({ type, msg });
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const getDraftValue = <K extends keyof TvScreen>(
    scr: TvScreen,
    field: K
  ): TvScreen[K] => {
    const d = drafts[scr.id];
    if (d && field in d) {
      return d[field] as TvScreen[K];
    }
    return scr[field];
  };

  const setDraftField = (id: number, patch: Partial<TvScreen>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));
  };

  const handleCreateScreen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusyId(-1);
    try {
      await apiFetch('/api/admin/tv-screens', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          courtId: newCourtId ? Number(newCourtId) : null,
          bannerSubtitle: data.settings?.eventName || 'Smansage Volleyball Competition',
        }),
      });
      setNewName('');
      setNewCourtId('');
      await onRefresh();
      notify('ok', 'Profil Layar TV baru berhasil dibuat');
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const pushRemoteUpdate = async (
    screenId: number,
    patch: Record<string, unknown>,
    successMsg?: string
  ) => {
    setBusyId(screenId);
    try {
      await apiFetch(`/api/admin/tv-screens/${screenId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[screenId];
        return next;
      });
      await onRefresh();
      if (successMsg) notify('ok', successMsg);
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleUploadCustomBanner = async (screenId: number, rawFile: File) => {
    setBusyId(screenId);
    try {
      const prepared = await normalizeImageInBrowser(rawFile, {
        maxDimension: 1920,
        preserveAlpha: false,
      });
      const fd = new FormData();
      fd.append('file', prepared);
      await apiFetch(`/api/admin/tv-screens/${screenId}/banner`, {
        method: 'POST',
        body: fd,
      });
      await onRefresh();
      notify('ok', 'Gambar banner latar TV diperbarui & langsung dikirim ke layar');
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteScreen = (scr: TvScreen) => {
    setPendingDeleteScreen(scr);
  };

  const confirmDeleteScreen = async () => {
    if (!pendingDeleteScreen) return;
    const scr = pendingDeleteScreen;
    setBusyId(scr.id);
    try {
      await apiFetch(`/api/admin/tv-screens/${scr.id}`, { method: 'DELETE' });
      setPendingDeleteScreen(null);
      await onRefresh();
      notify('ok', `"${scr.name}" dihapus`);
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const copyScreenUrl = (scr: TvScreen) => {
    const fullUrl = `${window.location.origin}/tv?screen=${scr.slug}`;
    navigator.clipboard.writeText(fullUrl).catch(() => {});
    setCopiedId(scr.id);
    window.setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="animate-page-enter space-y-5">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
              <Monitor className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                Manajemen &amp; Remote Kontrol Layar TV ({screens.length})
              </h2>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Buat profil layar TV terpisah untuk setiap lapangan atau proyektor aula,
                lalu <strong>remot tampilannya dari jarak jauh</strong> (Skor Live,
                Bagan TM, atau Dynamic Standby Banner) secara real-time via SSE.
              </p>
            </div>
          </div>

          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
            <Radio className="h-3.5 w-3.5" />
            PIN Arena TV: {data.settings?.tvPin || '4426'}
          </span>
        </div>

        {/* Add New TV Screen Form */}
        <form
          onSubmit={handleCreateScreen}
          className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800"
        >
          <input
            type="text"
            required
            placeholder="Nama Profil TV Baru (mis: TV Lapangan 2 / Proyektor Aula)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
          />
          <select
            value={newCourtId}
            onChange={(e) => setNewCourtId(e.target.value)}
            aria-label="Lapangan Default untuk TV Baru"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">Semua Lapangan / Proyektor Umum</option>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>
                Ikat ke: {c.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busyId === -1}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Buat Layar TV
          </button>
        </form>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs font-bold ${
            feedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* TV Screen Remote Control Cards */}
      <div className="grid gap-5 xl:grid-cols-2">
        {screens.map((scr) => {
          const isBusy = busyId === scr.id;
          const activeMode = getDraftValue(scr, 'mode');
          const tvUrl = `/tv?screen=${scr.slug}`;
          const draftPreset = getDraftValue(scr, 'bannerPreset');
          const draftTitle = getDraftValue(scr, 'bannerTitle');
          const draftSubtitle = getDraftValue(scr, 'bannerSubtitle');
          const draftBadge = getDraftValue(scr, 'bannerBadge');
          const draftNotice = getDraftValue(scr, 'bannerNoticeText');
          const draftClock = getDraftValue(scr, 'showClock');
          const draftSponsors = getDraftValue(scr, 'showSponsors');

          return (
            <div
              key={scr.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="space-y-4">
                {/* Card Header & Quick Open Links */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-700 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                        AKTIF: {scr.mode.toUpperCase()}
                      </span>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {tvUrl}
                      </code>
                    </div>
                    <input
                      type="text"
                      defaultValue={scr.name}
                      aria-label={`Nama Profil TV ${scr.name}`}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== scr.name) {
                          pushRemoteUpdate(scr.id, { name: v }, 'Nama TV diperbarui');
                        }
                      }}
                      className="mt-1 w-full rounded bg-transparent font-display text-lg font-extrabold uppercase tracking-wide text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-white dark:hover:bg-slate-800"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => copyScreenUrl(scr)}
                      title="Salin Link Layar TV"
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:border-amber-500 dark:border-slate-700 dark:text-slate-300"
                    >
                      {copiedId === scr.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedId === scr.id ? 'Tersalin' : 'Link'}
                    </button>
                    <a
                      href={tvUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950"
                    >
                      Buka TV
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDeleteScreen(scr)}
                      disabled={isBusy}
                      aria-label={`Hapus ${scr.name}`}
                      title="Hapus Profil TV"
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-500 sm:min-h-8 sm:min-w-8"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* 1-Click Remote Mode Selector */}
                <div>
                  <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                    Remote Kontrol Mode Tampilan (Push Instan ke Layar):
                  </span>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                    {MODE_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const active = activeMode === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setDraftField(scr.id, { mode: opt.value });
                            pushRemoteUpdate(
                              scr.id,
                              { mode: opt.value },
                              `${scr.name} dialihkan ke mode ${opt.label}`
                            );
                          }}
                          className={`flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-bold transition ${
                            active
                              ? 'bg-amber-500 text-slate-950 shadow-sm'
                              : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-amber-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Contextual Remote Targets for Score Modes */}
                {(activeMode === 'single' ||
                  activeMode === 'split' ||
                  activeMode === 'auto_rotate') && (
                  <div className="grid gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-slate-500">
                        Filter / Fokus Lapangan:
                      </label>
                      <select
                        value={scr.courtId ?? ''}
                        disabled={isBusy}
                        onChange={(e) =>
                          pushRemoteUpdate(
                            scr.id,
                            {
                              courtId: e.target.value ? Number(e.target.value) : null,
                            },
                            'Fokus lapangan TV diperbarui'
                          )
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="">Otomatis (Semua Lapangan)</option>
                        {courts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {activeMode !== 'auto_rotate' && (
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-500">
                          Pertandingan Utama yang Ditampilkan:
                        </label>
                        <select
                          value={scr.targetMatchId ?? ''}
                          disabled={isBusy}
                          onChange={(e) =>
                            pushRemoteUpdate(
                              scr.id,
                              {
                                targetMatchId: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              },
                              'Pertandingan target dikirim ke TV'
                            )
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="">Otomatis (Match Live Terbaru)</option>
                          {playableMatches.map((m) => {
                            const tA = m.teamAId
                              ? teamMap.get(m.teamAId)?.shortCode
                              : 'TBD';
                            const tB = m.teamBId
                              ? teamMap.get(m.teamBId)?.shortCode
                              : 'TBD';
                            return (
                              <option key={m.id} value={m.id}>
                                [{m.status.toUpperCase()}] {m.courtName}: {tA} vs {tB}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}

                    {activeMode === 'split' && (
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-[11px] font-bold text-slate-500">
                          Pertandingan Layar 2 (Mode Split):
                        </label>
                        <select
                          value={scr.secondaryMatchId ?? ''}
                          disabled={isBusy}
                          onChange={(e) =>
                            pushRemoteUpdate(
                              scr.id,
                              {
                                secondaryMatchId: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              },
                              'Pertandingan kedua dikirim ke TV'
                            )
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="">Otomatis (Match Live Kedua)</option>
                          {playableMatches.map((m) => {
                            const tA = m.teamAId
                              ? teamMap.get(m.teamAId)?.shortCode
                              : 'TBD';
                            const tB = m.teamBId
                              ? teamMap.get(m.teamBId)?.shortCode
                              : 'TBD';
                            return (
                              <option key={m.id} value={m.id}>
                                {m.courtName}: {tA} vs {tB}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* Bracket / TM Mode Target */}
                {activeMode === 'bracket' && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                    <label className="mb-1 block text-[11px] font-bold text-slate-500">
                      Kategori Bagan / TM Drawing yang Disorot:
                    </label>
                    <select
                      value={scr.bracketTournamentId ?? ''}
                      disabled={isBusy}
                      onChange={(e) =>
                        pushRemoteUpdate(
                          scr.id,
                          {
                            bracketTournamentId: e.target.value
                              ? Number(e.target.value)
                              : null,
                          },
                          'Kategori bagan dikirim ke TV'
                        )
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="">Kategori Aktif Pertama / Mengikuti Undian</option>
                      {data.tournaments.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Dynamic Standby Banner Editor */}
                {activeMode === 'standby' && (
                  <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs dark:bg-amber-500/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                        Konfigurasi Dynamic Standby Banner
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {(Object.keys(BANNER_PRESET_DEFAULTS) as TvBannerPreset[]).map(
                          (presetKey) => {
                            const p = BANNER_PRESET_DEFAULTS[presetKey];
                            const selected = draftPreset === presetKey;
                            return (
                              <button
                                key={presetKey}
                                type="button"
                                onClick={() => {
                                  const nextPatch = {
                                    bannerPreset: presetKey,
                                    bannerBadge: p.badge,
                                    bannerTitle: p.title,
                                    bannerSubtitle:
                                      presetKey === 'custom'
                                        ? data.settings?.eventName || p.subtitle
                                        : p.subtitle,
                                    bannerNoticeText: p.notice,
                                  };
                                  setDraftField(scr.id, nextPatch);
                                  pushRemoteUpdate(
                                    scr.id,
                                    nextPatch,
                                    `Preset banner "${p.label}" dikirim ke ${scr.name}`
                                  );
                                }}
                                className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                                  selected
                                    ? 'bg-amber-500 text-slate-950'
                                    : 'border border-amber-500/30 bg-white text-slate-700 hover:border-amber-500 dark:bg-slate-950 dark:text-slate-200'
                                }`}
                              >
                                {p.label}
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        type="text"
                        placeholder="Badge (mis: STANDBY TM)"
                        value={draftBadge}
                        onChange={(e) =>
                          setDraftField(scr.id, { bannerBadge: e.target.value })
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-extrabold uppercase dark:border-slate-700 dark:bg-slate-950"
                      />
                      <input
                        type="text"
                        placeholder="Judul Utama Banner"
                        value={draftTitle}
                        onChange={(e) =>
                          setDraftField(scr.id, { bannerTitle: e.target.value })
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold sm:col-span-2 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>

                    <input
                      type="text"
                      placeholder="Sub-judul / Keterangan Waktu & Tempat"
                      value={draftSubtitle}
                      onChange={(e) =>
                        setDraftField(scr.id, { bannerSubtitle: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />

                    <input
                      type="text"
                      placeholder="Running Text / Marquee Bawah (kosongkan jika tidak perlu)"
                      value={draftNotice}
                      onChange={(e) =>
                        setDraftField(scr.id, { bannerNoticeText: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />

                    {draftPreset === 'upcoming' && (
                      <select
                        value={scr.targetMatchId ?? ''}
                        onChange={(e) =>
                          pushRemoteUpdate(
                            scr.id,
                            {
                              targetMatchId: e.target.value
                                ? Number(e.target.value)
                                : null,
                            },
                            'Match berikutnya ditampilkan pada banner'
                          )
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="">Tanpa Kartu Match Berikutnya</option>
                        {playableMatches.map((m) => {
                          const tA = m.teamAId
                            ? teamMap.get(m.teamAId)?.name || 'TBD'
                            : 'TBD';
                          const tB = m.teamBId
                            ? teamMap.get(m.teamBId)?.name || 'TBD'
                            : 'TBD';
                          return (
                            <option key={m.id} value={m.id}>
                              Match Berikutnya: {tA} vs {tB} ({m.courtName})
                            </option>
                          );
                        })}
                      </select>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftClock}
                            onChange={(e) =>
                              setDraftField(scr.id, { showClock: e.target.checked })
                            }
                            className="h-3.5 w-3.5 accent-amber-500"
                          />
                          Jam Digital WIB
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={draftSponsors}
                            onChange={(e) =>
                              setDraftField(scr.id, { showSponsors: e.target.checked })
                            }
                            className="h-3.5 w-3.5 accent-amber-500"
                          />
                          Strip Sponsor
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold hover:border-amber-500 dark:border-slate-700 dark:bg-slate-950">
                          <ImagePlus className="h-3.5 w-3.5 text-amber-500" />
                          {scr.customBannerUrl ? 'Ganti Poster Latar' : 'Unggah Latar'}
                          <input
                            type="file"
                            accept={IMAGE_INPUT_ACCEPT}
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUploadCustomBanner(scr.id, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {scr.customBannerUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              pushRemoteUpdate(
                                scr.id,
                                { resetCustomBanner: true },
                                'Gambar latar banner dihapus'
                              )
                            }
                            className="text-[11px] font-bold text-red-500 hover:underline"
                          >
                            Hapus Latar
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          pushRemoteUpdate(
                            scr.id,
                            {
                              bannerPreset: draftPreset,
                              bannerBadge: draftBadge,
                              bannerTitle: draftTitle,
                              bannerSubtitle: draftSubtitle,
                              bannerNoticeText: draftNotice,
                              showClock: draftClock,
                              showSponsors: draftSponsors,
                            },
                            `Banner Standby dikirim ke ${scr.name}`
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-[11px] font-extrabold text-white transition hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Terapkan ke TV
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteScreen)}
        title="Hapus Profil Layar TV?"
        message={
          pendingDeleteScreen
            ? `Hapus profil layar "${pendingDeleteScreen.name}" (/tv?screen=${pendingDeleteScreen.slug})? TV fisik yang membuka URL ini tidak akan menerima remote kontrol lagi.`
            : ''
        }
        confirmLabel="Ya, Hapus Profil TV"
        busy={pendingDeleteScreen !== null && busyId === pendingDeleteScreen.id}
        onConfirm={confirmDeleteScreen}
        onCancel={() => setPendingDeleteScreen(null)}
      />
    </div>
  );
}

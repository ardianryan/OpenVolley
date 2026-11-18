import {
  Building2,
  ChevronDown,
  FileSpreadsheet,
  ImagePlus,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  MASTER_TEAM_LEVEL_LABELS,
  type MasterTeamLevel,
} from '../../shared/fivb-draw';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TeamAvatar } from '../components/TeamAvatar';
import { apiFetch } from '../lib/api';
import {
  IMAGE_INPUT_ACCEPT,
  normalizeImageInBrowser,
} from '../lib/mediaConverter';
import { parseJerseyColors } from '../lib/seo';
import type { MasterTeam, OverviewData } from '../types';

interface MasterTeamsManagerProps {
  data: OverviewData;
  onRefresh: () => Promise<void>;
}

const LEVEL_OPTIONS: Array<{ value: 'all' | MasterTeamLevel; label: string }> = [
  { value: 'all', label: 'Semua Tingkat' },
  { value: 'smp', label: 'SMP / MTs' },
  { value: 'sma', label: 'SMA / SMK / MA' },
  { value: 'kab_kota', label: 'Kab / Kota' },
  { value: 'umum', label: 'Klub / Umum' },
];

export function MasterTeamsManager({ data, onRefresh }: MasterTeamsManagerProps) {
  const masterTeams = data.masterTeams ?? [];
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | MasterTeamLevel>('all');
  const [showBulkModal, setShowBulkModal] = useState(false);

  // Single create form
  const [newName, setNewName] = useState('');
  const [newSchool, setNewSchool] = useState('');
  const [newLevel, setNewLevel] = useState<MasterTeamLevel>('smp');
  const [newShortCode, setNewShortCode] = useState('');

  // Bulk Google Sheets / Excel paste
  const [bulkText, setBulkText] = useState('');
  const [bulkDefaultLevel, setBulkDefaultLevel] = useState<MasterTeamLevel>('smp');

  // Expanded details card
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [jerseyLabelInput, setJerseyLabelInput] = useState('');
  const [jerseyHexInput, setJerseyHexInput] = useState('#1E293B');
  const [busy, setBusy] = useState(false);
  const [pendingDeleteMaster, setPendingDeleteMaster] = useState<MasterTeam | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  const notify = (type: 'ok' | 'err', msg: string) => {
    setFeedback({ type, msg });
    window.setTimeout(() => setFeedback(null), 4000);
  };

  // Count which categories each Master Team participates in
  const categoryUsageByMaster = useMemo(() => {
    const tNameById = new Map(data.tournaments.map((t) => [t.id, t.name]));
    const usage = new Map<number, string[]>();
    for (const tm of data.teams) {
      if (!tm.masterTeamId) continue;
      const catName = tNameById.get(tm.tournamentId);
      if (!catName) continue;
      const arr = usage.get(tm.masterTeamId) ?? [];
      const tag = tm.squadLabel ? `${catName} (${tm.squadLabel})` : catName;
      if (!arr.includes(tag)) arr.push(tag);
      usage.set(tm.masterTeamId, arr);
    }
    return usage;
  }, [data.teams, data.tournaments]);

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return masterTeams.filter((mt) => {
      if (levelFilter !== 'all' && mt.level !== levelFilter) return false;
      if (!q) return true;
      return (
        mt.name.toLowerCase().includes(q) ||
        mt.school.toLowerCase().includes(q) ||
        mt.shortCode.toLowerCase().includes(q)
      );
    });
  }, [masterTeams, levelFilter, searchQuery]);

  const previewBulkCount = useMemo(() => {
    return bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(
        (l) =>
          Boolean(l) &&
          !/^(no\b|nama\s+(sekolah|tim|kontingen))/i.test(l)
      ).length;
  }, [bulkText]);

  const handleCreateSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await apiFetch('/api/admin/master-teams', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          school: newSchool.trim(),
          level: newLevel,
          shortCode: newShortCode.trim() || undefined,
        }),
      });
      setNewName('');
      setNewSchool('');
      setNewShortCode('');
      await onRefresh();
      notify('ok', 'Kontingen baru berhasil ditambahkan ke Master Tim');
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkText.trim() || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch<{
        insertedCount: number;
        skippedCount: number;
      }>('/api/admin/master-teams/bulk', {
        method: 'POST',
        body: JSON.stringify({
          lines: bulkText,
          defaultLevel: bulkDefaultLevel,
        }),
      });
      setBulkText('');
      setShowBulkModal(false);
      await onRefresh();
      notify(
        'ok',
        `${res.insertedCount} kontingen berhasil diimpor${
          res.skippedCount > 0 ? ` (${res.skippedCount} duplikat dilewati)` : ''
        }`
      );
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePatchMaster = async (
    id: number,
    patch: Omit<Partial<MasterTeam>, 'defaultJerseyColors'> & {
      defaultJerseyColors?: string | Array<{ label: string; hex: string }>;
    }
  ) => {
    try {
      await apiFetch(`/api/admin/master-teams/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await onRefresh();
    } catch (err) {
      notify('err', (err as Error).message);
    }
  };

  const handleUploadMasterLogo = async (id: number, rawFile: File) => {
    try {
      const prepared = await normalizeImageInBrowser(rawFile, {
        maxDimension: 1024,
        preserveAlpha: true,
      });
      const fd = new FormData();
      fd.append('file', prepared);
      await apiFetch(`/api/admin/master-teams/${id}/logo`, {
        method: 'POST',
        body: fd,
      });
      await onRefresh();
      notify('ok', 'Logo diperbarui & disinkronkan ke seluruh kategori terkait');
    } catch (err) {
      notify('err', (err as Error).message);
    }
  };

  const handleDeleteMaster = (mt: MasterTeam) => {
    setPendingDeleteMaster(mt);
  };

  const confirmDeleteMaster = async () => {
    if (!pendingDeleteMaster) return;
    const mt = pendingDeleteMaster;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/master-teams/${mt.id}`, {
        method: 'DELETE',
      });
      setPendingDeleteMaster(null);
      await onRefresh();
      notify('ok', `"${mt.name}" dihapus dari Master Kontingen`);
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-page-enter space-y-5">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
              Database Master Tim &amp; Kontingen ({masterTeams.length})
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Input nama sekolah / kabupaten, logo, pelatih, manajer &amp; kostum cukup{' '}
              <strong>1 kali</strong>. Saat TM Drawing di tiap kategori (Putra/Putri/SMA/SMP),
              tinggal cari dari dropdown tanpa ketik ulang.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowBulkModal((v) => !v)}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3.5 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-500 hover:text-slate-950 dark:text-amber-300 dark:hover:text-slate-950"
        >
          <FileSpreadsheet className="h-4 w-4" />
          {showBulkModal ? 'Tutup Import Sheets' : 'Import dari Google Sheets / Excel'}
        </button>
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

      {/* Bulk Paste Panel (Google Sheets Tab-Separated or Pipe-Separated) */}
      {showBulkModal ? (
        <form
          onSubmit={handleBulkImport}
          className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 dark:bg-amber-500/10"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                Copy-Paste Langsung dari Google Sheets / Excel
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Blok kolom <code>Nama Sekolah</code> dan <code>Kab/Kota</code> di Google Sheets
                lalu Paste di bawah (otomatis melewati baris judul &amp; duplikat).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Tingkat Default:</span>
              <select
                value={bulkDefaultLevel}
                onChange={(e) => setBulkDefaultLevel(e.target.value as MasterTeamLevel)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="smp">SMP / MTs</option>
                <option value="sma">SMA / SMK / MA</option>
                <option value="kab_kota">Kontingen Kab / Kota</option>
                <option value="umum">Klub / Umum</option>
              </select>
            </div>
          </div>

          <textarea
            rows={6}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={
              'SMPN 2 Kota Mojokerto\tKota Mojokerto\nSMPN 1 Gedeg\tKab. Mojokerto\nKab. Sidoarjo\tJawa Timur'
            }
            className="w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs text-slate-900 focus:border-amber-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">
              Terdeteksi <strong>{previewBulkCount}</strong> baris kontingen siap impor
            </span>
            <button
              type="submit"
              disabled={busy || previewBulkCount === 0}
              className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shadow transition hover:bg-amber-400 disabled:opacity-40"
            >
              Impor ke Master Kontingen
            </button>
          </div>
        </form>
      ) : (
        /* Quick Single Add Form */
        <form
          onSubmit={handleCreateSingle}
          className="grid gap-2.5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[1.4fr_1.1fr_0.8fr_0.5fr_auto]"
        >
          <input
            type="text"
            required
            placeholder="Nama Sekolah / Kontingen (mis: Kab. Mojokerto / SMAN 1 Gedeg)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            type="text"
            placeholder="Asal Kota / Kabupaten / Provinsi"
            value={newSchool}
            onChange={(e) => setNewSchool(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
          <select
            value={newLevel}
            onChange={(e) => setNewLevel(e.target.value as MasterTeamLevel)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="smp">SMP / MTs</option>
            <option value="sma">SMA / SMK / MA</option>
            <option value="kab_kota">Kab / Kota</option>
            <option value="umum">Klub / Umum</option>
          </select>
          <input
            type="text"
            maxLength={6}
            placeholder="Kode (4hrf)"
            value={newShortCode}
            onChange={(e) => setNewShortCode(e.target.value.toUpperCase())}
            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold uppercase dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
          >
            <Plus className="h-4 w-4" />
            Simpan
          </button>
        </form>
      )}

      {/* Search & Level Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {LEVEL_OPTIONS.map((opt) => {
            const active = levelFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLevelFilter(opt.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  active
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-amber-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Cari nama sekolah / kota / kode..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-medium dark:border-slate-800 dark:bg-slate-900"
          />
        </div>
      </div>

      {/* Master Teams Grid */}
      {filteredList.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-xs text-slate-500 dark:border-slate-800">
          Belum ada kontingen yang cocok dengan filter pencarian ini.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredList.map((mt) => {
            const isExpanded = expandedId === mt.id;
            const usedCategories = categoryUsageByMaster.get(mt.id) ?? [];
            const defaultJerseys = parseJerseyColors(mt.defaultJerseyColors);

            return (
              <div
                key={mt.id}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <TeamAvatar team={mt} size="md" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <input
                        type="text"
                        defaultValue={mt.name}
                        aria-label={`Nama Master ${mt.name}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== mt.name) {
                            handlePatchMaster(mt.id, { name: v });
                          }
                        }}
                        className="w-full truncate rounded bg-transparent px-1 py-0.5 text-sm font-extrabold text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-white dark:hover:bg-slate-800 dark:focus:bg-slate-800"
                      />
                      <input
                        type="text"
                        defaultValue={mt.school}
                        placeholder="Asal Kota / Kabupaten"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== mt.school) {
                            handlePatchMaster(mt.id, { school: v });
                          }
                        }}
                        className="w-full truncate rounded bg-transparent px-1 py-0.5 text-xs text-slate-500 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-slate-400 dark:hover:bg-slate-800 dark:focus:bg-slate-800"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`Detail default ${mt.name}`}
                      title="Detail Default (Pelatih, Manajer, Kostum, Kode)"
                      onClick={() => setExpandedId(isExpanded ? null : mt.id)}
                      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg transition sm:min-h-8 sm:min-w-8 ${
                        isExpanded
                          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800'
                      }`}
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    <label
                      title="Upload Logo Master (Otomatis Sinkron Semua Kategori)"
                      className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-amber-500 sm:min-h-8 sm:min-w-8 dark:hover:bg-slate-800"
                    >
                      <ImagePlus className="h-4 w-4" />
                      <input
                        type="file"
                        accept={IMAGE_INPUT_ACCEPT}
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUploadMasterLogo(mt.id, f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      aria-label={`Hapus ${mt.name}`}
                      title="Hapus dari Master Kontingen"
                      onClick={() => handleDeleteMaster(mt)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-500 sm:min-h-8 sm:min-w-8"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Level Pill & Active Categories Usage */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-2 text-[11px] dark:border-slate-800/80">
                  <select
                    value={mt.level}
                    onChange={(e) =>
                      handlePatchMaster(mt.id, {
                        level: e.target.value as MasterTeamLevel,
                      })
                    }
                    aria-label="Tingkat Kontingen"
                    className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {(Object.keys(MASTER_TEAM_LEVEL_LABELS) as MasterTeamLevel[]).map(
                      (lv) => (
                        <option key={lv} value={lv}>
                          {MASTER_TEAM_LEVEL_LABELS[lv]}
                        </option>
                      )
                    )}
                  </select>

                  {usedCategories.length > 0 ? (
                    <span className="truncate font-semibold text-emerald-600 dark:text-emerald-400">
                      Aktif: {usedCategories.join(', ')}
                    </span>
                  ) : (
                    <span className="text-slate-400">Belum masuk bagan</span>
                  )}
                </div>

                {/* Expandable Default Staff, Color, ShortCode & Jerseys */}
                {isExpanded && (
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <input
                        type="text"
                        defaultValue={mt.shortCode}
                        maxLength={6}
                        placeholder="Singkatan"
                        onBlur={(e) => {
                          const v = e.target.value.trim().toUpperCase();
                          if (v && v !== mt.shortCode) {
                            handlePatchMaster(mt.id, { shortCode: v });
                          }
                        }}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold uppercase dark:border-slate-700 dark:bg-slate-950"
                      />
                      <input
                        type="color"
                        defaultValue={mt.color || '#E09D17'}
                        title="Warna Identitas Kontingen"
                        onBlur={(e) => {
                          if (e.target.value !== mt.color) {
                            handlePatchMaster(mt.id, { color: e.target.value });
                          }
                        }}
                        className="h-7 w-9 cursor-pointer rounded border border-slate-200 bg-transparent p-0"
                      />
                    </div>

                    <input
                      type="text"
                      defaultValue={mt.defaultCoachName}
                      placeholder="Pelatih Utama Default (opsional)"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== mt.defaultCoachName) {
                          handlePatchMaster(mt.id, { defaultCoachName: v });
                        }
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />

                    <input
                      type="text"
                      defaultValue={mt.defaultManagerName}
                      placeholder="Manajer / Official Kontingen Default (opsional)"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== mt.defaultManagerName) {
                          handlePatchMaster(mt.id, { defaultManagerName: v });
                        }
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />

                    <div className="space-y-1.5">
                      <span className="block text-[11px] font-bold text-slate-500">
                        Kostum Default Kontingen:
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        {defaultJerseys.map((jc, jIdx) => (
                          <span
                            key={`${jc.label}-${jIdx}`}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-950"
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full border border-slate-400/40"
                              style={{ backgroundColor: jc.hex }}
                            />
                            {jc.label}
                            <button
                              type="button"
                              onClick={() => {
                                const next = defaultJerseys.filter(
                                  (_, i2) => i2 !== jIdx
                                );
                                handlePatchMaster(mt.id, {
                                  defaultJerseyColors: next,
                                });
                              }}
                              className="ml-0.5 text-slate-400 hover:text-red-500"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>

                      {defaultJerseys.length < 4 && (
                        <div className="flex items-center gap-1">
                          <input
                            type="color"
                            value={jerseyHexInput}
                            onChange={(e) => setJerseyHexInput(e.target.value)}
                            className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-transparent p-0"
                          />
                          <input
                            type="text"
                            value={jerseyLabelInput}
                            onChange={(e) => setJerseyLabelInput(e.target.value)}
                            placeholder="Warna kostum (mis: Merah)"
                            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!jerseyLabelInput.trim()) return;
                              handlePatchMaster(mt.id, {
                                defaultJerseyColors: [
                                  ...defaultJerseys,
                                  {
                                    label: jerseyLabelInput.trim(),
                                    hex: jerseyHexInput,
                                  },
                                ],
                              });
                              setJerseyLabelInput('');
                            }}
                            className="rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-bold text-white dark:bg-amber-500 dark:text-slate-950"
                          >
                            + Kostum
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingDeleteMaster)}
        title="Hapus dari Master Kontingen?"
        message={
          pendingDeleteMaster
            ? (categoryUsageByMaster.get(pendingDeleteMaster.id) ?? []).length > 0
              ? `Hapus "${pendingDeleteMaster.name}" dari Master Kontingen? Tim di kategori ${(categoryUsageByMaster.get(pendingDeleteMaster.id) ?? []).join(', ')} tetap aman tetapi terlepas dari sinkronisasi Master.`
              : `Hapus "${pendingDeleteMaster.name}" dari Master Kontingen?`
            : ''
        }
        confirmLabel="Ya, Hapus Master"
        busy={busy}
        onConfirm={confirmDeleteMaster}
        onCancel={() => setPendingDeleteMaster(null)}
      />
    </div>
  );
}

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  GitBranch,
  GripVertical,
  ImagePlus,
  Layers,
  Palette,
  Plus,
  RotateCcw,
  Shuffle,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  MASTER_TEAM_LEVEL_LABELS,
  isPlaceholderDrawSlotName,
  type MasterTeamLevel,
} from '../../shared/fivb-draw';
import { formatInternationalStageLabel } from '../../shared/stages';
import { BracketView } from '../components/BracketView';
import { ConfirmDeleteCategoryModal } from '../components/ConfirmDeleteCategoryModal';
import { PoolStandingsView } from '../components/PoolStandingsView';
import { SearchableTeamPicker } from '../components/SearchableTeamPicker';
import { TeamAvatar } from '../components/TeamAvatar';
import { UserRolesManager } from '../components/UserRolesManager';
import { apiFetch } from '../lib/api';
import {
  IMAGE_INPUT_ACCEPT,
  normalizeImageInBrowser,
} from '../lib/mediaConverter';
import { parseJerseyColors } from '../lib/seo';
import type {
  AuthUser,
  JerseyColorItem,
  MasterTeam,
  OverviewData,
  SponsorItem,
  Tournament,
} from '../types';

interface AdminDashboardProps {
  data: OverviewData;
  currentUser: AuthUser;
  section: 'tournaments' | 'branding' | 'users';
  onRefresh: () => Promise<void>;
}

export function AdminDashboard({
  data,
  currentUser,
  section,
  onRefresh,
}: AdminDashboardProps) {
  const [selectedTid, setSelectedTid] = useState<number | null>(
    data.tournaments[0]?.id ?? null
  );
  const [stepTab, setStepTab] = useState<'teams' | 'bracket' | 'schedule'>('teams');
  const [showNewCat, setShowNewCat] = useState(false);
  const [pendingDeleteTournament, setPendingDeleteTournament] = useState<Tournament | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // New Category form
  const [newCatName, setNewCatName] = useState('');
  const [bestOf, setBestOf] = useState<1 | 3 | 5>(3);
  const [regPts, setRegPts] = useState(25);
  const [decPts, setDecPts] = useState(15);
  const [useDeuce, setUseDeuce] = useState(true);
  const [hasThirdPlace, setHasThirdPlace] = useState(true);

  // Team form & optional detail drawer
  const [teamName, setTeamName] = useState('');
  const [teamSchool, setTeamSchool] = useState('');
  const [bulkLines, setBulkLines] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);
  const [newJerseyLabel, setNewJerseyLabel] = useState('');
  const [newJerseyHex, setNewJerseyHex] = useState('#111827');
  const [downloadingBulletin, setDownloadingBulletin] = useState(false);

  // Pool stage & FIVB Smart Draw config state
  const [poolCountField, setPoolCountField] = useState<number>(4);
  const [advancePerPoolField, setAdvancePerPoolField] = useState<number>(2);
  const [separateSameRegion, setSeparateSameRegion] = useState<boolean>(true);

  // Batch pick from Master Contingents state
  const [showMasterBatchPicker, setShowMasterBatchPicker] = useState<boolean>(false);
  const [masterBatchLevel, setMasterBatchLevel] = useState<'all' | MasterTeamLevel>('all');
  const [masterBatchSearch, setMasterBatchSearch] = useState<string>('');
  const [selectedMasterIds, setSelectedMasterIds] = useState<number[]>([]);

  // Branding form
  const [eventName, setEventName] = useState(data.settings?.eventName || '');
  const [eventSubtitle, setEventSubtitle] = useState(data.settings?.eventSubtitle || '');
  const [eventMeta, setEventMeta] = useState(data.settings?.eventMeta || '');
  const [seoDescription, setSeoDescription] = useState(
    data.settings?.seoDescription || ''
  );
  const [tvPinField, setTvPinField] = useState(data.settings?.tvPin || '4426');
  const [publicTvEnabled, setPublicTvEnabled] = useState(
    Boolean(data.settings?.publicTvEnabled)
  );
  const [ogPreviewBust, setOgPreviewBust] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!selectedTid && data.tournaments[0]) {
      setSelectedTid(data.tournaments[0].id);
    }
  }, [data.tournaments, selectedTid]);

  useEffect(() => {
    if (data.settings) {
      setEventName(data.settings.eventName);
      setEventSubtitle(data.settings.eventSubtitle);
      setEventMeta(data.settings.eventMeta);
      setSeoDescription(data.settings.seoDescription || '');
      if (data.settings.tvPin) setTvPinField(data.settings.tvPin);
      setPublicTvEnabled(Boolean(data.settings.publicTvEnabled));
      setOgPreviewBust(Date.now());
    }
  }, [data.settings]);

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3500);
  };

  const activeTournament: Tournament | undefined =
    data.tournaments.find((t) => t.id === selectedTid) ?? data.tournaments[0];

  useEffect(() => {
    if (activeTournament) {
      setPoolCountField(activeTournament.poolCount ?? 4);
      setAdvancePerPoolField(activeTournament.advancePerPool ?? 2);
    }
  }, [activeTournament?.id]);
  const categoryTeams = data.teams.filter(
    (t) => t.tournamentId === activeTournament?.id
  );
  const categoryMatches = data.matches.filter(
    (m) => m.tournamentId === activeTournament?.id
  );
  const categoryMatchIdSet = new Set(categoryMatches.map((m) => m.id));
  const categoryReportCount = data.reports.filter((r) =>
    categoryMatchIdSet.has(r.matchId)
  ).length;

  const handleConfirmDeleteCategory = async () => {
    if (!pendingDeleteTournament || deletingCategory) return;
    setDeletingCategory(true);
    try {
      const targetId = pendingDeleteTournament.id;
      const targetName = pendingDeleteTournament.name;
      await apiFetch(`/api/admin/tournaments/${targetId}`, {
        method: 'DELETE',
      });
      const remaining = data.tournaments.filter((t) => t.id !== targetId);
      setSelectedTid(remaining[0]?.id ?? null);
      setPendingDeleteTournament(null);
      await onRefresh();
      flash(`Kategori "${targetName}" beserta seluruh tim, jadwal & pertandingan berhasil dihapus.`);
    } catch (err) {
      flash(`Gagal menghapus kategori: ${(err as Error).message}`);
    } finally {
      setDeletingCategory(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    const res = await apiFetch<{ tournament: Tournament }>('/api/admin/tournaments', {
      method: 'POST',
      body: JSON.stringify({
        name: newCatName,
        bestOf,
        regularSetPoints: regPts,
        decidingSetPoints: decPts,
        useDeuce,
        hasThirdPlace,
      }),
    });
    setNewCatName('');
    setSelectedTid(res.tournament.id);
    await onRefresh();
    flash('Kategori berhasil ditambahkan');
  };

  const toggleCategoryEnabled = async (t: Tournament) => {
    await apiFetch(`/api/admin/tournaments/${t.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled: !t.isEnabled }),
    });
    await onRefresh();
  };

  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTournament || !teamName.trim()) return;
    await apiFetch('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({
        tournamentId: activeTournament.id,
        name: teamName,
        school: teamSchool,
      }),
    });
    setTeamName('');
    setTeamSchool('');
    await onRefresh();
    flash('Tim ditambahkan');
  };

  const handleBulkTeams = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTournament || !bulkLines.trim()) return;
    await apiFetch('/api/admin/teams/bulk', {
      method: 'POST',
      body: JSON.stringify({ tournamentId: activeTournament.id, lines: bulkLines }),
    });
    setBulkLines('');
    setShowBulk(false);
    await onRefresh();
    flash('Daftar tim berhasil diimport');
  };

  const handleUploadTeamLogo = async (teamId: number, rawFile: File) => {
    try {
      const normalized = await normalizeImageInBrowser(rawFile, {
        maxDimension: 1024,
        preserveAlpha: true,
        onStatus: flash,
      });
      const fd = new FormData();
      fd.append('file', normalized);
      await apiFetch(`/api/admin/teams/${teamId}/logo`, {
        method: 'POST',
        body: fd,
      });
      await onRefresh();
      flash('Logo tim diperbarui');
    } catch (err) {
      flash(`Gagal memproses logo: ${(err as Error).message}`);
    }
  };

  const handleGenerateBracket = async (shuffle: boolean) => {
    if (!activeTournament) return;
    await apiFetch(`/api/admin/tournaments/${activeTournament.id}/generate-bracket`, {
      method: 'POST',
      body: JSON.stringify({ shuffle, separateSameRegion }),
    });
    await onRefresh();
    flash(
      shuffle && separateSameRegion
        ? 'Bagan FIVB berhasil diacak (Unggulan terkunci & Kota/Kab yang sama dipisahkan di Babak 1)!'
        : 'Bagan otomatis berhasil dibuat!'
    );
  };

  const handleInitDraw = async (slotCount: 4 | 8 | 16 | 32) => {
    if (!activeTournament) return;
    await apiFetch(`/api/admin/tournaments/${activeTournament.id}/init-draw`, {
      method: 'POST',
      body: JSON.stringify({ slotCount }),
    });
    await onRefresh();
    flash(`Slot Undian ${slotCount} Tim (Pool A Kiri & Pool B Kanan) siap diisi saat TM!`);
  };

  const handleAssignDrawSlot = async (
    slotTeamId: number,
    masterTeamId: number | null,
    options?: { squadLabel?: string }
  ) => {
    if (!activeTournament) return;
    try {
      await apiFetch(`/api/admin/tournaments/${activeTournament.id}/draw-slot`, {
        method: 'PUT',
        body: JSON.stringify({
          slotTeamId,
          masterTeamId,
          squadLabel: options?.squadLabel,
        }),
      });
      await onRefresh();
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const handleQuickCreateMaster = async (
    name: string,
    school: string
  ): Promise<MasterTeam | null> => {
    try {
      const res = await apiFetch<{ masterTeam: MasterTeam }>('/api/admin/master-teams', {
        method: 'POST',
        body: JSON.stringify({ name, school }),
      });
      return res.masterTeam;
    } catch (err) {
      flash((err as Error).message);
      return null;
    }
  };

  const handleBatchAddFromMaster = async () => {
    if (!activeTournament || selectedMasterIds.length === 0) return;
    try {
      const res = await apiFetch<{ teams: unknown[] }>(
        `/api/admin/tournaments/${activeTournament.id}/entries-from-master`,
        {
          method: 'POST',
          body: JSON.stringify({ masterTeamIds: selectedMasterIds }),
        }
      );
      setSelectedMasterIds([]);
      setShowMasterBatchPicker(false);
      await onRefresh();
      flash(`${res.teams.length} kontingen berhasil dimasukkan dari Master Tim!`);
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const handleInlineTeamUpdate = async (
    teamId: number,
    fields: {
      name?: string;
      school?: string;
      poolName?: string | null;
      isSeeded?: boolean;
      coachName?: string;
      managerName?: string;
      jerseyColors?: JerseyColorItem[];
    }
  ) => {
    await apiFetch(`/api/admin/teams/${teamId}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    await onRefresh();
  };

  const handleGeneratePools = async (shuffle: boolean) => {
    if (!activeTournament) return;
    try {
      await apiFetch(`/api/admin/tournaments/${activeTournament.id}/generate-pools`, {
        method: 'POST',
        body: JSON.stringify({
          poolCount: poolCountField,
          advancePerPool: advancePerPoolField,
          shuffle,
          separateSameRegion,
        }),
      });
      await onRefresh();
      flash(`Jadwal Fase Pool (${poolCountField} Pool) & Bagan Utama berhasil dibuat!`);
    } catch (err) {
      flash(`Gagal membuat Pool: ${(err as Error).message}`);
    }
  };

  const handleAdvancePools = async () => {
    if (!activeTournament) return;
    try {
      await apiFetch(`/api/admin/tournaments/${activeTournament.id}/advance-pools`, {
        method: 'POST',
      });
      await onRefresh();
      flash('Juara & Runner-up Pool berhasil ditempatkan ke Bagan Babak Utama!');
    } catch (err) {
      flash(`Gagal meloloskan tim Pool: ${(err as Error).message}`);
    }
  };

  const handleDownloadBulletinPdf = async (onlyActiveCategory = false) => {
    if (downloadingBulletin) return;
    setDownloadingBulletin(true);
    try {
      const { downloadTournamentBulletinPdf } = await import(
        '../lib/pdfDocuments'
      );
      await downloadTournamentBulletinPdf(data, {
        tournamentIds:
          onlyActiveCategory && activeTournament
            ? [activeTournament.id]
            : undefined,
      });
    } catch (err) {
      flash(`Gagal mengunduh Buletin PDF: ${(err as Error).message}`);
    } finally {
      setDownloadingBulletin(false);
    }
  };

  const handleMatchScheduleUpdate = async (
    matchId: number,
    fields: { courtName?: string; scheduledAt?: string }
  ) => {
    await apiFetch(`/api/admin/matches/${matchId}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    await onRefresh();
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        eventName,
        eventSubtitle,
        eventMeta,
        seoDescription,
        publicTvEnabled,
      }),
    });
    if (tvPinField.trim().length >= 4) {
      await apiFetch('/api/admin/tv-pin', {
        method: 'PUT',
        body: JSON.stringify({ tvPin: tvPinField.trim() }),
      });
    }
    await onRefresh();
    flash('Identitas acara, SEO & PIN TV diperbarui');
  };

  const handleUploadBrandLogo = async (
    target: 'main' | 'coBrand' | 'organizer' | 'social',
    rawFile: File
  ) => {
    try {
      const normalized = await normalizeImageInBrowser(rawFile, {
        maxDimension: 1400,
        preserveAlpha: true,
        onStatus: flash,
      });
      const fd = new FormData();
      fd.append('file', normalized);
      fd.append('target', target);
      await apiFetch('/api/admin/settings/logo', { method: 'POST', body: fd });
      await onRefresh();
      flash('Logo berhasil diunggah');
    } catch (err) {
      flash(`Gagal memproses logo: ${(err as Error).message}`);
    }
  };

  const [sponsorName, setSponsorName] = useState('');
  const [sponsorCat, setSponsorCat] = useState<'sponsor' | 'media_partner'>('sponsor');
  const [sponsorBoxed, setSponsorBoxed] = useState(false);
  const [sponsorFile, setSponsorFile] = useState<File | null>(null);
  const [sponsorDarkFile, setSponsorDarkFile] = useState<File | null>(null);
  const [sponsorBusy, setSponsorBusy] = useState(false);
  const [sponsorError, setSponsorError] = useState<string | null>(null);

  const sponsorList: SponsorItem[] = (() => {
    try {
      return JSON.parse(data.settings?.sponsorsJson || '[]');
    } catch {
      return [];
    }
  })();

  const handleUploadSponsor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sponsorFile) {
      setSponsorError('Pilih file logo sponsor (PNG/JPG/WEBP) terlebih dahulu');
      return;
    }
    setSponsorBusy(true);
    setSponsorError(null);
    try {
      const normalizedLight = await normalizeImageInBrowser(sponsorFile, {
        maxDimension: 1400,
        preserveAlpha: true,
      });
      const fd = new FormData();
      fd.append('file', normalizedLight);
      if (sponsorDarkFile) {
        const normalizedDark = await normalizeImageInBrowser(sponsorDarkFile, {
          maxDimension: 1400,
          preserveAlpha: true,
        });
        fd.append('darkFile', normalizedDark);
      }
      fd.append('name', sponsorName.trim() || 'Partner');
      fd.append('category', sponsorCat);
      fd.append('boxed', String(sponsorBoxed));
      await apiFetch('/api/admin/settings/sponsors', { method: 'POST', body: fd });
      setSponsorName('');
      setSponsorFile(null);
      setSponsorDarkFile(null);
      setSponsorBoxed(false);
      await onRefresh();
      flash('Logo Sponsor / Media Partner berhasil disimpan!');
    } catch (err) {
      setSponsorError((err as Error).message);
    } finally {
      setSponsorBusy(false);
    }
  };

  const handleDeleteSponsor = async (id: string) => {
    await apiFetch(`/api/admin/settings/sponsors/${id}`, { method: 'DELETE' });
    await onRefresh();
    flash('Sponsor dihapus');
  };

  const [dragSponsorId, setDragSponsorId] = useState<string | null>(null);

  const handleReorderSponsors = async (orderedIds: string[]) => {
    try {
      await apiFetch('/api/admin/settings/sponsors/reorder', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds }),
      });
      await onRefresh();
      flash('Urutan Sponsor & Media Partner diperbarui!');
    } catch (err) {
      setSponsorError((err as Error).message);
    }
  };

  const handleMoveSponsor = (index: number, delta: -1 | 1) => {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= sponsorList.length) return;
    const next = [...sponsorList];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    handleReorderSponsors(next.map((s) => s.id));
  };

  const handleDropSponsor = (targetId: string) => {
    if (!dragSponsorId || dragSponsorId === targetId) {
      setDragSponsorId(null);
      return;
    }
    const fromIdx = sponsorList.findIndex((s) => s.id === dragSponsorId);
    const toIdx = sponsorList.findIndex((s) => s.id === targetId);
    setDragSponsorId(null);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...sponsorList];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    handleReorderSponsors(next.map((s) => s.id));
  };

  const handleResetBrandLogo = async () => {
    await apiFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ resetLogo: true }),
    });
    await onRefresh();
    flash('Logo dikembalikan ke default SVC & AVERSA');
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          {message}
        </div>
      )}

      {section === 'tournaments' && (
        <>
          {/* Compact Category Bar + New Category Toggle */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pilih Kategori:
                </span>
                {data.tournaments.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTid(t.id)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                      t.id === activeTournament?.id
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowNewCat(!showNewCat)}
                  className="inline-flex items-center gap-1 rounded-xl border border-dashed border-amber-500/60 px-3 py-2 text-xs font-bold text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Kategori Baru
                </button>
              </div>

              {activeTournament && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={downloadingBulletin}
                    onClick={() => handleDownloadBulletinPdf(false)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 shadow-xs transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {downloadingBulletin ? 'Menyiapkan...' : 'Unduh Buletin PDF'}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleCategoryEnabled(activeTournament)}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      activeTournament.isEnabled
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {activeTournament.isEnabled ? (
                      <>
                        <Eye className="h-3.5 w-3.5" /> Tampil di Publik
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3.5 w-3.5" /> Disembunyikan
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setPendingDeleteTournament(activeTournament)}
                    aria-label={`Hapus kategori ${activeTournament.name}`}
                    title={`Hapus kategori ${activeTournament.name}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-red-200 bg-red-500/8 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:border-red-500 hover:bg-red-500/15 dark:border-red-900/60 dark:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Hapus Kategori</span>
                  </button>
                </div>
              )}
            </div>

            {showNewCat && (
              <form
                onSubmit={async (e) => {
                  await handleCreateCategory(e);
                  setShowNewCat(false);
                }}
                className="mt-4 grid gap-3 border-t border-slate-100 pt-4 dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-5"
              >
                <input
                  type="text"
                  required
                  placeholder="Nama Kategori (misal: SMA Putra)"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 lg:col-span-2"
                />
                <select
                  value={bestOf}
                  onChange={(e) => setBestOf(Number(e.target.value) as 1 | 3 | 5)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value={1}>1 Set</option>
                  <option value={3}>Best of 3</option>
                  <option value={5}>Best of 5</option>
                </select>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={5}
                    max={50}
                    title="Poin Set Biasa"
                    value={regPts}
                    onChange={(e) => setRegPts(Number(e.target.value))}
                    className="w-1/2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                  />
                  <input
                    type="number"
                    min={5}
                    max={30}
                    title="Poin Set Penentuan"
                    value={decPts}
                    onChange={(e) => setDecPts(Number(e.target.value))}
                    className="w-1/2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  Simpan Kategori
                </button>
                <div className="flex flex-wrap gap-4 text-xs sm:col-span-2 lg:col-span-5">
                  <label className="flex items-center gap-1.5 font-medium">
                    <input
                      type="checkbox"
                      checked={useDeuce}
                      onChange={(e) => setUseDeuce(e.target.checked)}
                    />
                    Deuce selisih 2
                  </label>
                  <label className="flex items-center gap-1.5 font-medium">
                    <input
                      type="checkbox"
                      checked={hasThirdPlace}
                      onChange={(e) => setHasThirdPlace(e.target.checked)}
                    />
                    Perebutan Juara 3
                  </label>
                </div>
              </form>
            )}
          </div>

          {/* Empty State if all categories have been deleted */}
          {!activeTournament && !showNewCat && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center dark:border-slate-800 dark:bg-slate-900/40">
              <GitBranch className="mx-auto mb-2.5 h-8 w-8 text-amber-500" />
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Belum Ada Kategori Pertandingan
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Klik tombol <strong>+ Kategori Baru</strong> di atas untuk mulai membuat kategori, mendaftarkan tim, dan menyusun bagan.
              </p>
            </div>
          )}

          {/* 3-Step Guided Workflow for Selected Category */}
          {activeTournament && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              {/* Stepper Tabs */}
              <div className="mb-5 grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1.5 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => setStepTab('teams')}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition sm:text-sm ${
                    stepTab === 'teams'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-amber-400'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  1. Tim &amp; Undian ({categoryTeams.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStepTab('bracket')}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition sm:text-sm ${
                    stepTab === 'bracket'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-amber-400'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  2. Bagan ({categoryMatches.length} Match)
                </button>
                <button
                  type="button"
                  onClick={() => setStepTab('schedule')}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition sm:text-sm ${
                    stepTab === 'schedule'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-amber-400'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  3. Jadwal &amp; Lapangan
                </button>
              </div>

              {/* STEP 1: TEAMS & TECHNICAL MEETING (TM) DRAWING */}
              {stepTab === 'teams' && (
                <div className="animate-page-enter space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 dark:bg-amber-500/10">
                    <div className="space-y-0.5 text-xs text-slate-700 dark:text-slate-200">
                      <p className="font-bold">
                        Panduan Technical Meeting (TM Drawing):
                      </p>
                      <p className="text-slate-600 dark:text-slate-400">
                        Siapkan slot undian (4/8/16/32), lalu tinggal cari &amp; pilih sekolah/kontingen dari{' '}
                        <strong>Master Kontingen</strong> pada dropdown tiap slot (otomatis tampil live via SSE di <code>/tv</code> &amp; <code>/bagan</code>).
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleInitDraw(32)}
                        className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                      >
                        Slot 32 Tim
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInitDraw(16)}
                        className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                      >
                        Slot 16 Tim (8+8)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInitDraw(8)}
                        className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                      >
                        Slot 8 Tim
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInitDraw(4)}
                        className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                      >
                        Slot 4 Tim
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMasterBatchPicker((v) => !v)}
                        className="inline-flex items-center gap-1 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-500/20 dark:text-sky-300"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {showMasterBatchPicker ? 'Tutup Pilih Master' : '+ Pilih Banyak dari Master'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowBulk(!showBulk)}
                        className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                      >
                        {showBulk ? 'Input Satuan' : 'Teks Manual'}
                      </button>
                    </div>
                  </div>

                  {/* Multi-Select Batch Picker from Master Contingents */}
                  {showMasterBatchPicker && (
                    <div className="space-y-3 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 dark:bg-sky-500/10">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-xs font-extrabold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                            Pilih Peserta Kategori dari Database Master Kontingen
                          </h4>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            Cocok untuk Fase Pool atau pra-undian sebelum menekan tombol <strong>Acak &amp; Buat Bagan</strong>.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {(
                            [
                              ['all', 'Semua'],
                              ['smp', 'SMP/MTs'],
                              ['sma', 'SMA/SMK'],
                              ['kab_kota', 'Kab/Kota'],
                              ['umum', 'Umum'],
                            ] as const
                          ).map(([lv, lbl]) => (
                            <button
                              key={lv}
                              type="button"
                              onClick={() => setMasterBatchLevel(lv)}
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                                masterBatchLevel === lv
                                  ? 'bg-sky-500 text-slate-950'
                                  : 'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                          <input
                            type="search"
                            value={masterBatchSearch}
                            onChange={(e) => setMasterBatchSearch(e.target.value)}
                            placeholder="Filter nama/kota..."
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                          />
                        </div>
                      </div>

                      <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                        {(data.masterTeams ?? [])
                          .filter((mt) => {
                            if (masterBatchLevel !== 'all' && mt.level !== masterBatchLevel) {
                              return false;
                            }
                            const q = masterBatchSearch.trim().toLowerCase();
                            if (!q) return true;
                            return (
                              mt.name.toLowerCase().includes(q) ||
                              mt.school.toLowerCase().includes(q)
                            );
                          })
                          .map((mt) => {
                            const alreadyIn = categoryTeams.some(
                              (ct) => ct.masterTeamId === mt.id && !(ct.squadLabel || '')
                            );
                            const checked = selectedMasterIds.includes(mt.id);
                            return (
                              <label
                                key={mt.id}
                                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs transition ${
                                  alreadyIn
                                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-55 dark:border-slate-800 dark:bg-slate-900'
                                    : checked
                                      ? 'border-sky-500 bg-sky-500/15 font-bold'
                                      : 'border-slate-200 bg-white hover:border-sky-400 dark:border-slate-800 dark:bg-slate-950'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={alreadyIn}
                                  checked={checked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedMasterIds((prev) => [...prev, mt.id]);
                                    } else {
                                      setSelectedMasterIds((prev) =>
                                        prev.filter((id) => id !== mt.id)
                                      );
                                    }
                                  }}
                                />
                                <TeamAvatar team={mt} size="sm" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-bold text-slate-900 dark:text-white">
                                    {mt.name}
                                  </p>
                                  <p className="truncate text-[10px] text-slate-500">
                                    {mt.school || MASTER_TEAM_LEVEL_LABELS[mt.level]}
                                    {alreadyIn ? ' • Sudah Terdaftar' : ''}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                      </div>

                      <div className="flex items-center justify-between border-t border-sky-500/20 pt-2.5">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Terpilih: <strong>{selectedMasterIds.length}</strong> kontingen
                        </span>
                        <button
                          type="button"
                          disabled={selectedMasterIds.length === 0}
                          onClick={handleBatchAddFromMaster}
                          className="rounded-xl bg-sky-500 px-4 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
                        >
                          Masukkan ke Kategori Ini
                        </button>
                      </div>
                    </div>
                  )}

                  {showBulk ? (
                    <form
                      onSubmit={handleBulkTeams}
                      className="space-y-2 rounded-xl bg-slate-50 p-4 dark:bg-slate-950"
                    >
                      <p className="text-xs font-semibold text-slate-500">
                        Masukkan 1 tim per baris (opsional pisahkan kota/sekolah dengan <code>|</code>)
                      </p>
                      <textarea
                        rows={4}
                        value={bulkLines}
                        onChange={(e) => setBulkLines(e.target.value)}
                        placeholder="SMPN 1 GEDEG | MOJOKERTO&#10;SMPN 1 KEMLAGI | MOJOKERTO"
                        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                      />
                      <button
                        type="submit"
                        className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950"
                      >
                        Simpan Semua Tim
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleAddTeam} className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        placeholder="Tambah Tim Manual (atau pilih dari dropdown Master di kartu bawah)"
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                      <input
                        type="text"
                        placeholder="Asal Kota / Kabupaten (opsional)"
                        value={teamSchool}
                        onChange={(e) => setTeamSchool(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white dark:bg-amber-500 dark:text-slate-950"
                      >
                        <Plus className="h-4 w-4" />
                        Tambah Slot
                      </button>
                    </form>
                  )}

                  {/* TM Draw Progress Summary */}
                  {categoryTeams.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        Slot Terisi:{' '}
                        <strong className="text-slate-900 dark:text-white">
                          {categoryTeams.filter((t) => !isPlaceholderDrawSlotName(t.name)).length} /{' '}
                          {categoryTeams.length}
                        </strong>{' '}
                        Tim
                      </span>
                      <span>
                        Tim Unggulan (Seeded):{' '}
                        <strong className="text-amber-600 dark:text-amber-400">
                          {categoryTeams.filter((t) => Boolean(t.isSeeded)).length}
                        </strong>
                      </span>
                    </div>
                  )}

                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {categoryTeams.map((team, idx) => {
                      const isExpanded = expandedTeamId === team.id;
                      const jerseys = parseJerseyColors(team.jerseyColors);
                      const isEmptySlot = isPlaceholderDrawSlotName(team.name);
                      const linkedMaster = team.masterTeamId
                        ? (data.masterTeams ?? []).find((m) => m.id === team.masterTeamId)
                        : undefined;
                      const hasStaffOverride = Boolean(
                        linkedMaster &&
                          ((team.coachName &&
                            team.coachName !== linkedMaster.defaultCoachName) ||
                            (team.managerName &&
                              team.managerName !== linkedMaster.defaultManagerName))
                      );
                      const isRightWing =
                        activeTournament.format !== 'pool_knockout' &&
                        categoryTeams.length >= 4 &&
                        idx >= Math.ceil(categoryTeams.length / 2);

                      return (
                        <div
                          key={team.id}
                          className={`rounded-xl border p-2.5 transition ${
                            isEmptySlot
                              ? 'border-dashed border-amber-500/40 bg-amber-500/[0.03] dark:border-amber-500/30'
                              : team.isSeeded
                                ? 'border-amber-400/70 bg-amber-500/[0.04] dark:border-amber-500/50'
                                : 'border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          {/* Top Slot Header: Undian # / Wing / Seeded Star / Actions */}
                          <div className="mb-2 flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-400 dark:bg-slate-800">
                                {team.poolName
                                  ? `POOL ${team.poolName}`
                                  : `UNDIAN ${String(idx + 1).padStart(2, '0')}`}
                              </span>
                              {activeTournament.format !== 'pool_knockout' &&
                                categoryTeams.length >= 4 && (
                                  <span
                                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                      isRightWing
                                        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                        : 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
                                    }`}
                                  >
                                    {isRightWing ? 'Pool B (Kanan)' : 'Pool A (Kiri)'}
                                  </span>
                                )}
                            </div>

                            <div className="flex items-center gap-0.5">
                              {!isEmptySlot && (
                                <button
                                  type="button"
                                  title="Tandai Tim Unggulan (Seeded — dipisah paruh bagan saat FIVB Draw)"
                                  onClick={() =>
                                    handleInlineTeamUpdate(team.id, {
                                      isSeeded: !team.isSeeded,
                                    })
                                  }
                                  className={`rounded-lg p-1 transition ${
                                    team.isSeeded
                                      ? 'bg-amber-500/20 text-amber-500'
                                      : 'text-slate-300 hover:text-amber-400 dark:text-slate-600'
                                  }`}
                                >
                                  <Star
                                    className="h-3.5 w-3.5"
                                    fill={team.isSeeded ? 'currentColor' : 'none'}
                                  />
                                </button>
                              )}
                              <button
                                type="button"
                                title="Detail Opsional Kategori (Pool, Override Pelatih/Manajer/Kostum)"
                                onClick={() =>
                                  setExpandedTeamId(isExpanded ? null : team.id)
                                }
                                className={`rounded-lg p-1 transition ${
                                  isExpanded
                                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800'
                                }`}
                              >
                                <ChevronDown
                                  className={`h-3.5 w-3.5 transition-transform ${
                                    isExpanded ? 'rotate-180' : ''
                                  }`}
                                />
                              </button>
                              <label
                                title="Upload Logo Khusus Kategori Ini"
                                className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-800"
                              >
                                <ImagePlus className="h-3.5 w-3.5" />
                                <input
                                  type="file"
                                  accept={IMAGE_INPUT_ACCEPT}
                                  className="hidden"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleUploadTeamLogo(team.id, f);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                title="Hapus Slot / Tim"
                                onClick={async () => {
                                  await apiFetch(`/api/admin/teams/${team.id}`, {
                                    method: 'DELETE',
                                  });
                                  await onRefresh();
                                }}
                                className="rounded-lg p-1 text-slate-400 hover:bg-red-500/10 hover:text-red-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Searchable Master Team Dropdown + Avatar + Auto-Populated School/City */}
                          <div className="flex items-center gap-2.5">
                            <TeamAvatar team={team} size="sm" />
                            <div className="min-w-0 flex-1 space-y-1">
                              <SearchableTeamPicker
                                slotTeam={team}
                                slotIndex={idx}
                                masterTeams={data.masterTeams ?? []}
                                categoryTeams={categoryTeams}
                                onAssignMaster={(masterId, opts) =>
                                  handleAssignDrawSlot(team.id, masterId, opts)
                                }
                                onQuickCreateMaster={handleQuickCreateMaster}
                              />
                              <div className="flex items-center justify-between gap-1 px-1">
                                <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                                  {isEmptySlot
                                    ? 'Kosong (Menunggu Undian)'
                                    : team.school || 'Asal daerah belum diisi'}
                                </span>
                                {linkedMaster && (
                                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                    {hasStaffOverride ? 'Override' : 'Master'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5 text-xs dark:border-slate-800">
                              {linkedMaster && (
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                  Terhubung ke Master <strong>{linkedMaster.name}</strong>. Mengubah
                                  Pelatih/Manajer/Kostum di bawah hanya berlaku pada kategori{' '}
                                  <strong>{activeTournament.name}</strong>.
                                </p>
                              )}
                              <div className="grid grid-cols-2 gap-1.5">
                                <input
                                  type="text"
                                  key={`nm-${team.id}-${team.name}`}
                                  defaultValue={team.name}
                                  placeholder="Nama Tampil Tim"
                                  onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (val && val !== team.name) {
                                      handleInlineTeamUpdate(team.id, { name: val });
                                    }
                                  }}
                                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                                />
                                <input
                                  type="text"
                                  key={`sc-${team.id}-${team.school}`}
                                  defaultValue={team.school}
                                  placeholder="Asal Kota / Kab"
                                  onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (val !== team.school) {
                                      handleInlineTeamUpdate(team.id, { school: val });
                                    }
                                  }}
                                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                                />
                              </div>
                              <div className="grid grid-cols-3 gap-1.5">
                                <input
                                  type="text"
                                  defaultValue={team.poolName || ''}
                                  placeholder="Pool (A-H)"
                                  maxLength={4}
                                  onBlur={(e) => {
                                    const v = e.target.value.trim().toUpperCase();
                                    if (v !== (team.poolName || '')) {
                                      handleInlineTeamUpdate(team.id, {
                                        poolName: v || null,
                                      });
                                    }
                                  }}
                                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold uppercase dark:border-slate-700 dark:bg-slate-950"
                                />
                                <input
                                  type="text"
                                  key={`ch-${team.id}-${team.coachName}`}
                                  defaultValue={team.coachName || ''}
                                  placeholder="Pelatih kategori ini"
                                  onBlur={(e) => {
                                    const v = e.target.value.trim();
                                    if (v !== (team.coachName || '')) {
                                      handleInlineTeamUpdate(team.id, { coachName: v });
                                    }
                                  }}
                                  className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                                />
                              </div>

                              <input
                                type="text"
                                key={`mg-${team.id}-${team.managerName}`}
                                defaultValue={team.managerName || ''}
                                placeholder="Manajer / Official kategori ini"
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v !== (team.managerName || '')) {
                                    handleInlineTeamUpdate(team.id, { managerName: v });
                                  }
                                }}
                                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                              />

                              <div className="space-y-1.5">
                                <div className="flex flex-wrap items-center gap-1">
                                  {jerseys.map((jc, jIdx) => (
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
                                          const next = jerseys.filter(
                                            (_, idx2) => idx2 !== jIdx
                                          );
                                          handleInlineTeamUpdate(team.id, {
                                            jerseyColors: next,
                                          });
                                        }}
                                        className="ml-0.5 text-slate-400 hover:text-red-500"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))}
                                </div>

                                {jerseys.length < 4 && (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="color"
                                      value={newJerseyHex}
                                      onChange={(e) => setNewJerseyHex(e.target.value)}
                                      className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-transparent p-0"
                                    />
                                    <input
                                      type="text"
                                      value={newJerseyLabel}
                                      onChange={(e) => setNewJerseyLabel(e.target.value)}
                                      placeholder="Warna kostum (mis: Hitam)"
                                      className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!newJerseyLabel.trim()) return;
                                        handleInlineTeamUpdate(team.id, {
                                          jerseyColors: [
                                            ...jerseys,
                                            {
                                              label: newJerseyLabel.trim(),
                                              hex: newJerseyHex,
                                            },
                                          ],
                                        });
                                        setNewJerseyLabel('');
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
                </div>
              )}

              {/* STEP 2: BRACKET & POOL STAGE */}
              {stepTab === 'bracket' && (
                <div className="animate-page-enter space-y-5">
                  {/* Format Selector: Pure Knockout vs Pool Stage -> Knockout */}
                  <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 dark:bg-amber-500/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                        Format Kompetisi Kategori Ini
                      </span>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                          <input
                            type="checkbox"
                            checked={separateSameRegion}
                            onChange={(e) => setSeparateSameRegion(e.target.checked)}
                          />
                          Pisahkan Kota/Kab Sama di Babak Awal (FIVB)
                        </label>
                        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(
                                `/api/admin/tournaments/${activeTournament.id}`,
                                {
                                  method: 'PATCH',
                                  body: JSON.stringify({ format: 'knockout' }),
                                }
                              );
                              await onRefresh();
                            }}
                            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                              (activeTournament.format || 'knockout') === 'knockout'
                                ? 'bg-amber-500 text-slate-950'
                                : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            Sistem Gugur Langsung
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(
                                `/api/admin/tournaments/${activeTournament.id}`,
                                {
                                  method: 'PATCH',
                                  body: JSON.stringify({ format: 'pool_knockout' }),
                                }
                              );
                              await onRefresh();
                            }}
                            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                              activeTournament.format === 'pool_knockout'
                                ? 'bg-amber-500 text-slate-950'
                                : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            Fase Pool → Babak Gugur
                          </button>
                        </div>
                      </div>
                    </div>

                    {activeTournament.format === 'pool_knockout' ? (
                      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-amber-500/20 pt-3">
                        <div className="flex flex-wrap items-end gap-2.5">
                          <div>
                            <label className="mb-1 block text-[11px] font-bold text-slate-600 dark:text-slate-400">
                              Jumlah Pool
                            </label>
                            <select
                              value={poolCountField}
                              onChange={(e) =>
                                setPoolCountField(Number(e.target.value))
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                            >
                              {[2, 3, 4, 6, 8].map((n) => (
                                <option key={n} value={n}>
                                  {n} Pool (Pool A..{String.fromCharCode(64 + n)})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] font-bold text-slate-600 dark:text-slate-400">
                              Tim Lolos / Pool
                            </label>
                            <select
                              value={advancePerPoolField}
                              onChange={(e) =>
                                setAdvancePerPoolField(Number(e.target.value))
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                            >
                              <option value={1}>Juara Pool Saja (Top 1)</option>
                              <option value={2}>Juara &amp; Runner-Up (Top 2)</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleGeneratePools(true)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
                          >
                            <Shuffle className="h-3.5 w-3.5" />
                            Acak Pool &amp; Buat Jadwal
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGeneratePools(false)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                          >
                            <Layers className="h-3.5 w-3.5" />
                            Buat Sesuai Pool Tim
                          </button>
                          <button
                            type="button"
                            onClick={handleAdvancePools}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            Loloskan Juara Pool ke Bagan Utama
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-500/20 pt-3">
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                          Buat bagan sistem gugur otomatis dari daftar tim saat ini, atau acak undiannya.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleGenerateBracket(true)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
                          >
                            <Shuffle className="h-3.5 w-3.5" />
                            Acak &amp; Buat Bagan
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGenerateBracket(false)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                          >
                            <GitBranch className="h-3.5 w-3.5" />
                            Buat Sesuai Urutan
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {activeTournament.format === 'pool_knockout' && (
                    <PoolStandingsView
                      tournament={activeTournament}
                      teams={categoryTeams}
                      matches={categoryMatches}
                    />
                  )}

                  <BracketView matches={categoryMatches} teams={categoryTeams} />
                </div>
              )}

              {/* STEP 3: SCHEDULE & COURTS */}
              {stepTab === 'schedule' && (
                <div className="animate-page-enter space-y-4">
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs font-medium text-slate-700 dark:bg-amber-500/10 dark:text-slate-200">
                    <strong>Panduan Langkah 3:</strong> Isi hari, jam, dan lapangan untuk setiap pertandingan (tersimpan otomatis saat berpindah kolom).
                  </div>
                  {categoryMatches.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      Buat bagan terlebih dahulu di Langkah 2.
                    </p>
                  ) : (
                    <div className="grid gap-2.5 md:grid-cols-2">
                      {categoryMatches.map((m, idx) => {
                        const tA = categoryTeams.find((t) => t.id === m.teamAId)?.name || 'TBD';
                        const tB = categoryTeams.find((t) => t.id === m.teamBId)?.name || 'TBD';
                        const mr = categoryMatches
                          .filter((x) => x.bracketType === 'main')
                          .map((x) => x.round);
                        const tr = mr.length > 0 ? Math.max(...mr) : 3;
                        return (
                          <div
                            key={m.id}
                            className="space-y-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-amber-500">
                                Match {idx + 1} •{' '}
                                {formatInternationalStageLabel(m, tr)}
                              </span>
                              <span className="truncate font-semibold text-slate-600 dark:text-slate-300">
                                {tA} vs {tB}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                defaultValue={m.scheduledAt || ''}
                                placeholder="Sabtu, 21 Nov • 08.00 WIB"
                                onBlur={(e) => {
                                  const val = e.target.value.trim();
                                  if (val !== (m.scheduledAt || '')) {
                                    handleMatchScheduleUpdate(m.id, { scheduledAt: val });
                                  }
                                }}
                                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                              />
                              <select
                                value={m.courtName}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val && val !== m.courtName) {
                                    handleMatchScheduleUpdate(m.id, { courtName: val });
                                  }
                                }}
                                aria-label={`Lapangan ${tA} vs ${tB}`}
                                className="w-36 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                              >
                                {(data.masterCourts && data.masterCourts.length > 0
                                  ? data.masterCourts
                                  : [
                                      { id: -1, name: 'Lapangan 1' },
                                      { id: -2, name: 'Lapangan 2' },
                                    ]
                                ).map((c) => (
                                  <option key={c.id} value={c.name}>
                                    {c.name}
                                  </option>
                                ))}
                                {m.courtName &&
                                  !(data.masterCourts ?? []).some(
                                    (c) => c.name === m.courtName
                                  ) && <option value={m.courtName}>{m.courtName}</option>}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {section === 'branding' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={handleSaveBranding}
            className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-amber-500" />
              <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                Identitas Acara &amp; Teks Header
              </h2>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                Nama Kompetisi
              </label>
              <input
                type="text"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                Sub-judul / Event Induk (Default: AVERSA)
              </label>
              <input
                type="text"
                value={eventSubtitle}
                onChange={(e) => setEventSubtitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                Info Tambahan (Tahun / Lokasi)
              </label>
              <input
                type="text"
                value={eventMeta}
                onChange={(e) => setEventMeta(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                Deskripsi SEO &amp; Pratinjau Sosial (Meta Description)
              </label>
              <textarea
                rows={2}
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                placeholder="Kosongkan untuk deskripsi otomatis berdasarkan nama kompetisi &amp; subjudul..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                PIN Keamanan Layar TV Arena (/tv)
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={12}
                value={tvPinField}
                onChange={(e) => setTvPinField(e.target.value)}
                placeholder="4426"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-bold tracking-widest dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <input
                type="checkbox"
                checked={publicTvEnabled}
                onChange={(e) => setPublicTvEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-amber-500"
              />
              <span className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                <strong className="block text-slate-900 dark:text-white">
                  Buka Akses Layar TV untuk Publik
                </strong>
                Saat nonaktif (default), tombol &quot;Layar Skor TV&quot; disembunyikan dari
                portal depan dan layar fisik terlindungi PIN TV Arena.
              </span>
            </label>

            <button
              type="submit"
              className="rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
            >
              Simpan Perubahan Teks, SEO &amp; PIN TV
            </button>

            {/* Auto-Generated Dynamic Social Image (1200x630 PNG) Preview & Optional Override */}
            <div className="space-y-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    Social Share Card (WhatsApp / X / Telegram • 1200×630)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {data.settings?.socialImageUrl
                      ? 'Menggunakan banner kustom unggahan Anda.'
                      : 'Dibuat otomatis dari engine web mengikuti Logo Crest SVC & teks kompetisi.'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold hover:border-amber-500 dark:border-slate-700 dark:bg-slate-950">
                    Unggah Kustom
                    <input
                      type="file"
                      accept={IMAGE_INPUT_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadBrandLogo('social', f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {data.settings?.socialImageUrl && (
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch('/api/admin/settings', {
                          method: 'PUT',
                          body: JSON.stringify({ resetSocialImage: true }),
                        });
                        await onRefresh();
                        flash('Social image dikembalikan ke generator otomatis SVC.');
                      }}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-red-500 dark:border-slate-700 dark:text-slate-400"
                    >
                       Pakai Otomatis
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800">
                <img
                  src={
                    data.settings?.socialImageUrl
                      ? data.settings.socialImageUrl
                      : `/api/public/og-image.png?v=${ogPreviewBust}`
                  }
                  alt="Pratinjau OpenGraph Social Card"
                  className="aspect-[1200/630] w-full object-cover"
                />
              </div>
            </div>
          </form>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                Logo Dinamis (Default SVC &amp; AVERSA)
              </h2>
              <button
                type="button"
                onClick={handleResetBrandLogo}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:border-amber-500 dark:border-slate-700"
              >
                <RotateCcw className="h-3 w-3" />
                Reset Default SVC
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col items-center rounded-xl border border-slate-200 p-4 text-center dark:border-slate-800">
                <img
                  src={data.settings?.logoUrl || '/brand/svc-crest-color.svg'}
                  alt="Logo Utama"
                  className="h-16 w-16 object-contain"
                />
                <p className="mt-2 text-xs font-bold">Logo Utama (SVC)</p>
                <label className="mt-2 cursor-pointer rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold hover:bg-amber-500 hover:text-slate-950 dark:bg-slate-800">
                  Unggah Baru
                  <input
                    type="file"
                    accept={IMAGE_INPUT_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadBrandLogo('main', f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              <div className="flex flex-col items-center rounded-xl border border-slate-200 p-4 text-center dark:border-slate-800">
                <img
                  src={data.settings?.coBrandLogoUrl || '/brand/aversa-standalone-color.svg'}
                  alt="Co-Brand AVERSA"
                  className="h-16 w-16 object-contain"
                />
                <p className="mt-2 text-xs font-bold">Co-Brand (AVERSA)</p>
                <label className="mt-2 cursor-pointer rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold hover:bg-amber-500 hover:text-slate-950 dark:bg-slate-800">
                  Unggah Baru
                  <input
                    type="file"
                    accept={IMAGE_INPUT_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadBrandLogo('coBrand', f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              <div className="flex flex-col items-center rounded-xl border border-slate-200 p-4 text-center dark:border-slate-800">
                <img
                  src={data.settings?.organizerLogoUrl || '/brand/logo_smansage.png'}
                  alt="Logo Penyelenggara"
                  className="h-16 w-16 object-contain"
                />
                <p className="mt-2 text-xs font-bold">Instansi (SMANSAGE)</p>
                <label className="mt-2 cursor-pointer rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold hover:bg-amber-500 hover:text-slate-950 dark:bg-slate-800">
                  Unggah Baru
                  <input
                    type="file"
                    accept={IMAGE_INPUT_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadBrandLogo('organizer', f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Sponsors & Media Partners */}
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                Sponsorship &amp; Media Partner (Penutup Video Tim Media)
              </h3>
              {sponsorError && (
                <div className="mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500">
                  {sponsorError}
                </div>
              )}
              <form onSubmit={handleUploadSponsor} className="mb-4 space-y-2.5">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Nama Sponsor / Media Partner"
                    value={sponsorName}
                    onChange={(e) => setSponsorName(e.target.value)}
                    className="min-w-[160px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                  <select
                    value={sponsorCat}
                    onChange={(e) =>
                      setSponsorCat(e.target.value as 'sponsor' | 'media_partner')
                    }
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="sponsor">Sponsor</option>
                    <option value="media_partner">Media Partner</option>
                  </select>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                    {sponsorFile
                      ? `Light: ${sponsorFile.name}`
                      : '1. Logo Light Mode / Utama (Wajib)'}
                    <input
                      type="file"
                      accept={IMAGE_INPUT_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        setSponsorFile(e.target.files?.[0] ?? null);
                        setSponsorError(null);
                      }}
                    />
                  </label>

                  <label className="cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                    {sponsorDarkFile
                      ? `Dark: ${sponsorDarkFile.name}`
                      : '2. Logo Dark Mode / Putih (Opsional)'}
                    <input
                      type="file"
                      accept={IMAGE_INPUT_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        setSponsorDarkFile(e.target.files?.[0] ?? null);
                        setSponsorError(null);
                      }}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={sponsorBoxed}
                      onChange={(e) => setSponsorBoxed(e.target.checked)}
                    />
                    Beri kotak putih (jika hanya punya 1 logo gelap)
                  </label>
                  <button
                    type="submit"
                    disabled={sponsorBusy}
                    className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                  >
                    {sponsorBusy ? 'Menyimpan...' : '+ Simpan Sponsor'}
                  </button>
                </div>
              </form>

              <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
                <p className="text-xs font-bold text-slate-500">
                  Urutan Logo Tersimpan ({sponsorList.length})
                </p>
                <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  Tarik (Drag) atau klik ↑/↓ • #1–#3 tampil paling besar (Utama)
                </span>
              </div>
              {sponsorList.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-800">
                  Belum ada logo Sponsor atau Media Partner tersimpan.
                </p>
              ) : (
                <div className="space-y-2">
                  {sponsorList.map((sp, idx) => {
                    const isPrincipal = idx < 3;
                    return (
                      <div
                        key={sp.id}
                        draggable
                        onDragStart={() => setDragSponsorId(sp.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDropSponsor(sp.id)}
                        className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 transition ${
                          isPrincipal
                            ? 'border-amber-500/45 bg-amber-500/5 dark:bg-amber-500/10'
                            : 'border-slate-200 dark:border-slate-800'
                        } ${dragSponsorId === sp.id ? 'opacity-50' : ''}`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className="cursor-grab text-slate-400 active:cursor-grabbing"
                            title="Tarik untuk mengubah urutan"
                          >
                            <GripVertical className="h-4 w-4" />
                          </span>
                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                              isPrincipal
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {isPrincipal ? `#${idx + 1} UTAMA` : `#${idx + 1}`}
                          </span>
                          <img
                            src={sp.logoUrl}
                            alt={sp.name}
                            title="Versi Light Mode"
                            className="h-9 w-12 shrink-0 rounded bg-slate-100 object-contain p-1"
                          />
                          {sp.darkLogoUrl && (
                            <img
                              src={sp.darkLogoUrl}
                              alt={`${sp.name} Dark`}
                              title="Versi Dark Mode"
                              className="h-9 w-12 shrink-0 rounded bg-slate-950 object-contain p-1 ring-1 ring-slate-700"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold">{sp.name}</p>
                            <p className="text-[11px] text-slate-500">
                              {sp.category === 'media_partner' ? 'Media Partner' : 'Sponsor'}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveSponsor(idx, -1)}
                            aria-label={`Geser ${sp.name} ke atas`}
                            title="Geser ke atas"
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 sm:min-h-8 sm:min-w-8 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === sponsorList.length - 1}
                            onClick={() => handleMoveSponsor(idx, 1)}
                            aria-label={`Geser ${sp.name} ke bawah`}
                            title="Geser ke bawah"
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 sm:min-h-8 sm:min-w-8 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSponsor(sp.id)}
                            aria-label={`Hapus ${sp.name}`}
                            title="Hapus"
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-slate-500 hover:bg-red-500/10 hover:text-red-600 sm:min-h-8 sm:min-w-8 dark:text-slate-400 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {section === 'users' &&
        (currentUser.role === 'admin' || currentUser.permissions?.includes('users')) && (
          <UserRolesManager currentUser={currentUser} onFlash={flash} />
        )}
      {pendingDeleteTournament && (
        <ConfirmDeleteCategoryModal
          tournament={pendingDeleteTournament}
          teamCount={
            data.teams.filter((t) => t.tournamentId === pendingDeleteTournament.id).length
          }
          matchCount={
            data.matches.filter((m) => m.tournamentId === pendingDeleteTournament.id).length
          }
          reportCount={
            pendingDeleteTournament.id === activeTournament?.id
              ? categoryReportCount
              : data.reports.filter((r) =>
                  data.matches.some(
                    (m) =>
                      m.id === r.matchId && m.tournamentId === pendingDeleteTournament.id
                  )
                ).length
          }
          deleting={deletingCategory}
          onConfirm={handleConfirmDeleteCategory}
          onClose={() => {
            if (!deletingCategory) setPendingDeleteTournament(null);
          }}
        />
      )}
    </div>
  );
}

import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GitBranch,
  GripVertical,
  ImagePlus,
  Palette,
  Plus,
  RotateCcw,
  Shuffle,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { BracketView } from '../components/BracketView';
import { TeamAvatar } from '../components/TeamAvatar';
import { apiFetch } from '../lib/api';
import {
  IMAGE_INPUT_ACCEPT,
  normalizeImageInBrowser,
} from '../lib/mediaConverter';
import type { AuthUser, OverviewData, SponsorItem, Tournament } from '../types';

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
  const [message, setMessage] = useState<string | null>(null);

  // New Category form
  const [newCatName, setNewCatName] = useState('');
  const [bestOf, setBestOf] = useState<1 | 3 | 5>(3);
  const [regPts, setRegPts] = useState(25);
  const [decPts, setDecPts] = useState(15);
  const [useDeuce, setUseDeuce] = useState(true);
  const [hasThirdPlace, setHasThirdPlace] = useState(true);

  // Team form
  const [teamName, setTeamName] = useState('');
  const [teamSchool, setTeamSchool] = useState('');
  const [bulkLines, setBulkLines] = useState('');
  const [showBulk, setShowBulk] = useState(false);

  // Branding form
  const [eventName, setEventName] = useState(data.settings?.eventName || '');
  const [eventSubtitle, setEventSubtitle] = useState(data.settings?.eventSubtitle || '');
  const [eventMeta, setEventMeta] = useState(data.settings?.eventMeta || '');

  // Users state
  const [userList, setUserList] = useState<Array<AuthUser & { createdAt: number }>>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'panitia' | 'media'>('panitia');

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
    }
  }, [data.settings]);

  useEffect(() => {
    if (section === 'users' && currentUser.role === 'admin') {
      apiFetch<{ users: Array<AuthUser & { createdAt: number }> }>('/api/auth/users')
        .then((res) => setUserList(res.users))
        .catch(() => {});
    }
  }, [section, currentUser.role]);

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3500);
  };

  const activeTournament: Tournament | undefined =
    data.tournaments.find((t) => t.id === selectedTid) ?? data.tournaments[0];
  const categoryTeams = data.teams.filter(
    (t) => t.tournamentId === activeTournament?.id
  );
  const categoryMatches = data.matches.filter(
    (m) => m.tournamentId === activeTournament?.id
  );

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
      body: JSON.stringify({ shuffle }),
    });
    await onRefresh();
    flash('Bagan otomatis berhasil dibuat!');
  };

  const handleInitDraw = async (slotCount: 4 | 8 | 16) => {
    if (!activeTournament) return;
    await apiFetch(`/api/admin/tournaments/${activeTournament.id}/init-draw`, {
      method: 'POST',
      body: JSON.stringify({ slotCount }),
    });
    await onRefresh();
    flash(`Slot Undian ${slotCount} Tim (Pool A & B) siap diisi!`);
  };

  const handleInlineTeamUpdate = async (
    teamId: number,
    fields: { name?: string; school?: string }
  ) => {
    await apiFetch(`/api/admin/teams/${teamId}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    await onRefresh();
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
      body: JSON.stringify({ eventName, eventSubtitle, eventMeta }),
    });
    await onRefresh();
    flash('Identitas acara diperbarui');
  };

  const handleUploadBrandLogo = async (
    target: 'main' | 'coBrand' | 'organizer',
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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch<{ user: AuthUser & { createdAt: number } }>(
      '/api/auth/users',
      {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          name: newFullName,
          password: newPassword,
          role: newRole,
        }),
      }
    );
    setUserList((prev) => [...prev, res.user]);
    setNewUsername('');
    setNewFullName('');
    setNewPassword('');
    flash('Akun baru dibuat');
  };

  const handleDeleteUser = async (id: number) => {
    await apiFetch(`/api/auth/users/${id}`, { method: 'DELETE' });
    setUserList((prev) => prev.filter((u) => u.id !== id));
    flash('Akun dihapus');
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
                <button
                  type="button"
                  onClick={() => toggleCategoryEnabled(activeTournament)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    activeTournament.isEnabled
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
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

              {/* STEP 1: TEAMS & DRAWING */}
              {stepTab === 'teams' && (
                <div className="animate-page-enter space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 dark:bg-amber-500/10">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      <strong>Panduan Langkah 1:</strong> Klik nama/kota tim untuk langsung mengedit saat Technical Meeting, atau buat slot undian baru.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleInitDraw(16)}
                        className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                      >
                        Reset Slot 16 Tim (4+4)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInitDraw(8)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                      >
                        Slot 8 Tim
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowBulk(!showBulk)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                      >
                        {showBulk ? 'Input Satuan' : 'Import Massal'}
                      </button>
                    </div>
                  </div>

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
                        placeholder="Tambah Nama Tim (misal: SMPN 1 GEDEG)"
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                      <input
                        type="text"
                        placeholder="Asal Kota / Sekolah (opsional)"
                        value={teamSchool}
                        onChange={(e) => setTeamSchool(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white dark:bg-amber-500 dark:text-slate-950"
                      >
                        <Plus className="h-4 w-4" />
                        Tambah Tim
                      </button>
                    </form>
                  )}

                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {categoryTeams.map((team, idx) => (
                      <div
                        key={team.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-800"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <span className="w-5 shrink-0 text-center text-xs font-extrabold text-amber-500">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <TeamAvatar team={team} size="sm" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <input
                              type="text"
                              defaultValue={team.name}
                              aria-label={`Nama Tim ${idx + 1}`}
                              onBlur={(e) => {
                                const val = e.target.value.trim();
                                if (val && val !== team.name) {
                                  handleInlineTeamUpdate(team.id, { name: val });
                                }
                              }}
                              className="w-full truncate rounded bg-transparent px-1 py-0.5 text-sm font-bold hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800"
                            />
                            <input
                              type="text"
                              defaultValue={team.school}
                              placeholder="Asal Kota / Sekolah"
                              onBlur={(e) => {
                                const val = e.target.value.trim();
                                if (val !== team.school) {
                                  handleInlineTeamUpdate(team.id, { school: val });
                                }
                              }}
                              className="w-full truncate rounded bg-transparent px-1 py-0.5 text-xs text-slate-500 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <label
                            title="Upload Logo Tim"
                            className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-800"
                          >
                            <ImagePlus className="h-4 w-4" />
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
                            onClick={async () => {
                              await apiFetch(`/api/admin/teams/${team.id}`, {
                                method: 'DELETE',
                              });
                              await onRefresh();
                            }}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-500"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 2: BRACKET & SHUFFLE */}
              {stepTab === 'bracket' && (
                <div className="animate-page-enter space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 dark:bg-amber-500/10">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      <strong>Panduan Langkah 2:</strong> Buat bagan otomatis dari daftar tim saat ini, atau acak undiannya.
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
                        const tA = categoryTeams.find((t) => t.id === m.teamAId)?.name || 'Menunggu';
                        const tB = categoryTeams.find((t) => t.id === m.teamBId)?.name || 'Menunggu';
                        return (
                          <div
                            key={m.id}
                            className="space-y-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-amber-500">
                                Match {idx + 1} •{' '}
                                {m.bracketType === 'third_place'
                                  ? 'Juara 3'
                                  : `Babak ${m.round}`}
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
                              <input
                                type="text"
                                defaultValue={m.courtName}
                                placeholder="Lapangan 1"
                                onBlur={(e) => {
                                  const val = e.target.value.trim();
                                  if (val && val !== m.courtName) {
                                    handleMatchScheduleUpdate(m.id, { courtName: val });
                                  }
                                }}
                                className="w-32 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                              />
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

            <button
              type="submit"
              className="rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
            >
              Simpan Perubahan Teks
            </button>
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

      {section === 'users' && currentUser.role === 'admin' && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-500" />
              <h2 className="font-display text-lg font-extrabold uppercase tracking-wider">
                Daftar Akun Panitia &amp; Tim Media
              </h2>
            </div>
            <div className="space-y-2">
              {userList.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                >
                  <div>
                    <p className="text-sm font-bold">{u.name}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      @{u.username} •{' '}
                      <span className="font-semibold uppercase text-amber-800 dark:text-amber-400">
                        {u.role}
                      </span>
                    </p>
                  </div>
                  {u.id !== currentUser.id && (
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(u.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={handleCreateUser}
            className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-amber-500" />
              <h3 className="font-display text-base font-extrabold uppercase tracking-wider">
                Buat Akun Baru
              </h3>
            </div>
            <input
              type="text"
              required
              placeholder="Username (tanpa spasi)"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="text"
              required
              placeholder="Nama Lengkap"
              value={newFullName}
              onChange={(e) => setNewFullName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'admin' | 'panitia' | 'media')}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="panitia">Panitia (Operator Skor &amp; Bagan)</option>
              <option value="media">Tim Media (Media Studio)</option>
              <option value="admin">Admin Penuh</option>
            </select>
            <button
              type="submit"
              className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
            >
              Tambah Akun
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

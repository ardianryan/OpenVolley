import {
  CheckSquare,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Globe,
  ImagePlus,
  Lock,
  RotateCcw,
  Save,
  Search,
  Square,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatInternationalStageLabel } from '../../shared/stages';
import { TeamAvatar } from '../components/TeamAvatar';
import { apiFetch } from '../lib/api';
import {
  IMAGE_INPUT_ACCEPT,
  normalizeImageInBrowser,
} from '../lib/mediaConverter';
import { parseOfficialDocSettings } from '../lib/seo';
import type {
  AuthUser,
  Match,
  OfficialDocSettings,
  OverviewData,
  Team,
} from '../types';

interface OfficialDocumentsProps {
  data: OverviewData;
  currentUser: AuthUser;
  onRefresh: () => Promise<void>;
}

export function OfficialDocuments({
  data,
  currentUser,
  onRefresh,
}: OfficialDocumentsProps) {
  const initialMeta = parseOfficialDocSettings(data.settings?.docSettingsJson);

  const [bulletinNumber, setBulletinNumber] = useState(
    initialMeta.bulletinNumber || 'BULETIN #1'
  );
  const [bulletinEdition, setBulletinEdition] = useState(
    initialMeta.bulletinEdition || 'Hasil Technical Meeting & Rekapitulasi Bagan'
  );
  const [venueName, setVenueName] = useState(
    initialMeta.venueName || data.settings?.eventMeta || ''
  );
  const [publishedDate, setPublishedDate] = useState(
    initialMeta.publishedDate || ''
  );
  const [referee1Default, setReferee1Default] = useState(
    initialMeta.referee1Default || ''
  );
  const [referee2Default, setReferee2Default] = useState(
    initialMeta.referee2Default || ''
  );
  const [committeeChair, setCommitteeChair] = useState(
    initialMeta.committeeChair || ''
  );
  const [publicDocsEnabled, setPublicDocsEnabled] = useState<boolean>(
    data.settings?.publicDocsEnabled !== false
  );

  const [selectedCatIds, setSelectedCatIds] = useState<number[]>(() =>
    data.tournaments.map((t) => t.id)
  );
  const [matchSearch, setMatchSearch] = useState('');
  const [matchCatFilter, setMatchCatFilter] = useState<number | 'all'>('all');
  const [matchStatusFilter, setMatchStatusFilter] = useState<
    'all' | 'finished' | 'live' | 'scheduled'
  >('all');

  const [savingMeta, setSavingMeta] = useState(false);
  const [generatingBulletin, setGeneratingBulletin] = useState(false);
  const [generatingMatchId, setGeneratingMatchId] = useState<number | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const parsed = parseOfficialDocSettings(data.settings?.docSettingsJson);
    setBulletinNumber(parsed.bulletinNumber || 'BULETIN #1');
    setBulletinEdition(
      parsed.bulletinEdition || 'Hasil Technical Meeting & Rekapitulasi Bagan'
    );
    setVenueName(parsed.venueName || data.settings?.eventMeta || '');
    setPublishedDate(parsed.publishedDate || '');
    setReferee1Default(parsed.referee1Default || '');
    setReferee2Default(parsed.referee2Default || '');
    setCommitteeChair(parsed.committeeChair || '');
    setPublicDocsEnabled(data.settings?.publicDocsEnabled !== false);
  }, [data.settings?.docSettingsJson, data.settings?.publicDocsEnabled, data.settings?.eventMeta]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const currentDocOverride: OfficialDocSettings = {
    bulletinNumber,
    bulletinEdition,
    venueName,
    publishedDate,
    coverImageUrl: initialMeta.coverImageUrl,
    referee1Default,
    referee2Default,
    committeeChair,
  };

  const handleSaveDocMeta = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSavingMeta(true);
    setError(null);
    try {
      await apiFetch('/api/admin/settings/docs', {
        method: 'PUT',
        body: JSON.stringify({
          docSettings: currentDocOverride,
          publicDocsEnabled:
            currentUser.role === 'admin' ? publicDocsEnabled : undefined,
        }),
      });
      await onRefresh();
      flash('Konfigurasi Dokumen Resmi berhasil disimpan!');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingMeta(false);
    }
  };

  const handleTogglePublicAccess = async (nextVal: boolean) => {
    if (currentUser.role !== 'admin') return;
    setPublicDocsEnabled(nextVal);
    try {
      await apiFetch('/api/admin/settings/docs', {
        method: 'PUT',
        body: JSON.stringify({ publicDocsEnabled: nextVal }),
      });
      await onRefresh();
      flash(
        nextVal
          ? 'Unduh PDF Publik diaktifkan di Portal Penonton.'
          : 'Unduh PDF Publik disembunyikan dari Portal Penonton.'
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleUploadCover = async (rawFile: File) => {
    setUploadingCover(true);
    setError(null);
    try {
      const normalized = await normalizeImageInBrowser(rawFile, {
        maxDimension: 1800,
        preserveAlpha: false,
      });
      const fd = new FormData();
      fd.append('file', normalized);
      await apiFetch('/api/admin/settings/doc-cover', {
        method: 'POST',
        body: fd,
      });
      await onRefresh();
      flash('Sampul kustom Buletin berhasil diunggah!');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingCover(false);
    }
  };

  const handleResetCover = async () => {
    setError(null);
    try {
      await apiFetch('/api/admin/settings/docs', {
        method: 'PUT',
        body: JSON.stringify({ resetDocCover: true }),
      });
      await onRefresh();
      flash('Sampul dikembalikan ke desain vektor otomatis.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDownloadBulletin = async () => {
    if (generatingBulletin) return;
    setGeneratingBulletin(true);
    setError(null);
    try {
      const { downloadTournamentBulletinPdf } = await import(
        '../lib/pdfDocuments'
      );
      await downloadTournamentBulletinPdf(data, {
        tournamentIds:
          selectedCatIds.length > 0
            ? selectedCatIds
            : data.tournaments.map((t) => t.id),
        docSettingsOverride: currentDocOverride,
      });
    } catch (err) {
      setError(`Gagal membuat PDF Buletin: ${(err as Error).message}`);
    } finally {
      setGeneratingBulletin(false);
    }
  };

  const teamMap = new Map<number, Team>(data.teams.map((t) => [t.id, t]));
  const tournamentMap = new Map(data.tournaments.map((t) => [t.id, t]));

  const handleDownloadMatchPdf = async (match: Match) => {
    if (generatingMatchId) return;
    setGeneratingMatchId(match.id);
    setError(null);
    try {
      const tournament = tournamentMap.get(match.tournamentId);
      const mainRounds = data.matches
        .filter(
          (m) => m.tournamentId === match.tournamentId && m.bracketType === 'main'
        )
        .map((m) => m.round);
      const totalMainRounds =
        mainRounds.length > 0 ? Math.max(...mainRounds) : 3;

      const { downloadMatchSummaryPdf } = await import('../lib/pdfDocuments');
      await downloadMatchSummaryPdf(match, {
        settings: data.settings,
        tournament,
        teamA: match.teamAId ? teamMap.get(match.teamAId) : undefined,
        teamB: match.teamBId ? teamMap.get(match.teamBId) : undefined,
        totalMainRounds,
        docSettingsOverride: currentDocOverride,
      });
    } catch (err) {
      setError(`Gagal membuat PDF Berita Acara: ${(err as Error).message}`);
    } finally {
      setGeneratingMatchId(null);
    }
  };

  const toggleCatId = (id: number) => {
    setSelectedCatIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const filteredMatches = data.matches
    .filter((m) => m.status !== 'bye')
    .filter((m) =>
      matchCatFilter === 'all' ? true : m.tournamentId === matchCatFilter
    )
    .filter((m) =>
      matchStatusFilter === 'all' ? true : m.status === matchStatusFilter
    )
    .filter((m) => {
      const q = matchSearch.trim().toLowerCase();
      if (!q) return true;
      const tA = m.teamAId ? teamMap.get(m.teamAId)?.name || '' : '';
      const tB = m.teamBId ? teamMap.get(m.teamBId)?.name || '' : '';
      const cat = tournamentMap.get(m.tournamentId)?.name || '';
      return (
        tA.toLowerCase().includes(q) ||
        tB.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q) ||
        m.courtName.toLowerCase().includes(q)
      );
    });

  return (
    <div className="space-y-6">
      {notice && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Top Public Visibility Toggle Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              publicDocsEnabled
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {publicDocsEnabled ? (
              <Globe className="h-5 w-5" />
            ) : (
              <Lock className="h-5 w-5" />
            )}
          </div>
          <div>
            <h2 className="font-display text-base font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
              Akses Unduh Dokumen Resmi di Portal Publik
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {publicDocsEnabled
                ? 'Aktif: Penonton & pelatih dapat mengunduh Buletin Resmi dan Berita Acara Hasil Pertandingan dari Portal Publik.'
                : 'Nonaktif: Tombol unduh PDF hanya tersedia di Back-Office untuk Admin & Panitia.'}
            </p>
          </div>
        </div>

        {currentUser.role === 'admin' ? (
          <button
            type="button"
            onClick={() => handleTogglePublicAccess(!publicDocsEnabled)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold uppercase tracking-wider transition ${
              publicDocsEnabled
                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                : 'border border-slate-300 bg-slate-100 text-slate-700 hover:border-amber-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            {publicDocsEnabled ? 'Publik: AKTIF (ON)' : 'Publik: NONAKTIF (OFF)'}
          </button>
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Status: {publicDocsEnabled ? 'Publik ON' : 'Internal Panitia'}
          </span>
        )}
      </div>

      {/* Main Two-Column Hub */}
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        {/* CARD 1: TOURNAMENT BULLETIN PDF BUILDER */}
        <form
          onSubmit={handleSaveDocMeta}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <div>
                <h3 className="font-display text-lg font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  Buletin Resmi Turnamen (PDF A4)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Sampul + Kartu Kontingen/Pool + Jadwal/Hasil + Bagan Babak Utama Vektor
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={generatingBulletin || data.tournaments.length === 0}
              onClick={handleDownloadBulletin}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-md shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {generatingBulletin ? 'Menyusun PDF...' : 'Unduh Buletin PDF'}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                Nomor / Judul Buletin
              </label>
              <input
                type="text"
                value={bulletinNumber}
                onChange={(e) => setBulletinNumber(e.target.value)}
                placeholder="BULETIN #1"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                Tanggal Terbit Edisi
              </label>
              <input
                type="text"
                value={publishedDate}
                onChange={(e) => setPublishedDate(e.target.value)}
                placeholder="Otomatis hari ini jika kosong"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                Subjudul Edisi Buletin
              </label>
              <input
                type="text"
                value={bulletinEdition}
                onChange={(e) => setBulletinEdition(e.target.value)}
                placeholder="Hasil Technical Meeting & Rekapitulasi Pertandingan"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                Lokasi / Venue Pertandingan
              </label>
              <input
                type="text"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                placeholder="GOR Utama SMAN 1 Gedeg • Mojokerto"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          {/* Category Filter for Bulletin */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Kategori yang Disertakan dalam Buletin
            </p>
            <div className="flex flex-wrap gap-2">
              {data.tournaments.map((t) => {
                const checked = selectedCatIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleCatId(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                      checked
                        ? 'border-amber-500 bg-amber-500/15 text-amber-900 dark:text-amber-300'
                        : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
                    }`}
                  >
                    {checked ? (
                      <CheckSquare className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Custom Cover Upload */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-800">
            <div className="flex items-center gap-3">
              {initialMeta.coverImageUrl ? (
                <img
                  src={initialMeta.coverImageUrl}
                  alt="Sampul Kustom"
                  className="h-14 w-10 rounded object-cover ring-1 ring-slate-300 dark:ring-slate-700"
                />
              ) : (
                <div className="flex h-14 w-10 items-center justify-center rounded bg-slate-900 text-[10px] font-extrabold text-amber-400">
                  AUTO
                </div>
              )}
              <div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Sampul Halaman 1 (A4 Portrait)
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {initialMeta.coverImageUrl
                    ? 'Menggunakan gambar sampul unggahan kustom.'
                    : 'Otomatis menggunakan desain sampul vektor sesuai Branding.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <ImagePlus className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                {uploadingCover ? 'Mengunggah...' : 'Unggah Sampul'}
                <input
                  type="file"
                  accept={IMAGE_INPUT_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadCover(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {initialMeta.coverImageUrl && (
                <button
                  type="button"
                  onClick={handleResetCover}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-red-500 dark:border-slate-700 dark:text-slate-400"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Default Referee & Sign-off Metadata */}
          <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Nama Default Perangkat Pertandingan (Untuk Berita Acara Match)
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Wasit I (Default Opsional)
                </label>
                <input
                  type="text"
                  value={referee1Default}
                  onChange={(e) => setReferee1Default(e.target.value)}
                  placeholder="Kosongkan untuk garis tanda tangan"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Wasit II / Scorer (Default Opsional)
                </label>
                <input
                  type="text"
                  value={referee2Default}
                  onChange={(e) => setReferee2Default(e.target.value)}
                  placeholder="Kosongkan untuk garis tanda tangan"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={savingMeta}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800 dark:bg-slate-800 dark:text-amber-300 dark:hover:bg-slate-700"
            >
              <Save className="h-3.5 w-3.5" />
              {savingMeta ? 'Menyimpan...' : 'Simpan Pengaturan Dokumen'}
            </button>
          </div>
        </form>

        {/* CARD 2: PER-MATCH OFFICIAL SUMMARY ARCHIVE */}
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
            <FileCheck2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div>
              <h3 className="font-display text-lg font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                Berita Acara Per Pertandingan (Match Summary)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                1 Halaman A4: Skor per set, Time-Out, Substitusi, Rasio Poin &amp; Kolom Tanda Tangan
              </p>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
                placeholder="Cari nama tim, kategori, atau lapangan..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <select
                value={matchCatFilter}
                onChange={(e) =>
                  setMatchCatFilter(
                    e.target.value === 'all' ? 'all' : Number(e.target.value)
                  )
                }
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="all">Semua Kategori</option>
                {data.tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              {(
                [
                  ['all', 'Semua'],
                  ['finished', 'Selesai'],
                  ['live', 'Live'],
                  ['scheduled', 'Jadwal'],
                ] as const
              ).map(([st, lbl]) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setMatchStatusFilter(st)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                    matchStatusFilter === st
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Match List */}
          <div className="max-h-[480px] flex-1 space-y-2 overflow-y-auto pr-1">
            {filteredMatches.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500 dark:border-slate-800">
                Belum ada pertandingan yang sesuai dengan filter pencarian.
              </div>
            ) : (
              filteredMatches.map((m) => {
                const tA = m.teamAId ? teamMap.get(m.teamAId) : null;
                const tB = m.teamBId ? teamMap.get(m.teamBId) : null;
                const cat = tournamentMap.get(m.tournamentId);
                const isBusy = generatingMatchId === m.id;
                const mainRounds = data.matches
                  .filter(
                    (x) =>
                      x.tournamentId === m.tournamentId && x.bracketType === 'main'
                  )
                  .map((x) => x.round);
                const tr = mainRounds.length > 0 ? Math.max(...mainRounds) : 3;
                const phaseText = formatInternationalStageLabel(m, tr);

                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-amber-500/50 dark:border-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        <span className="text-amber-700 dark:text-amber-400">
                          {cat?.name}
                        </span>
                        <span>•</span>
                        <span>{phaseText}</span>
                        <span>•</span>
                        <span>{m.courtName}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <TeamAvatar team={tA} size="sm" />
                        <span className="truncate text-xs font-bold text-slate-900 dark:text-white">
                          {tA?.name || 'Menunggu'}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-display text-xs font-extrabold tabular-nums text-slate-800 dark:bg-slate-800 dark:text-amber-300">
                          {m.status === 'finished' || m.status === 'live'
                            ? `${m.setsWonA} - ${m.setsWonB}`
                            : 'vs'}
                        </span>
                        <span className="truncate text-xs font-bold text-slate-900 dark:text-white">
                          {tB?.name || 'Menunggu'}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDownloadMatchPdf(m)}
                      className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 transition hover:border-amber-500 hover:bg-amber-500 hover:text-slate-950 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-amber-500 dark:hover:text-slate-950"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {isBusy ? 'Mencetak...' : 'PDF'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

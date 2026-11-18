import {
  ArrowRightLeft,
  CalendarClock,
  Copy,
  MapPin,
  Plus,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatInternationalStageLabel } from '../../shared/stages';
import { groupMatchesByScheduleDay } from '../../shared/schedule';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { apiFetch } from '../lib/api';
import type { MasterCourt, Match, OverviewData, Team, Tournament } from '../types';

interface ScheduleCourtsManagerProps {
  data: OverviewData;
  onRefresh: () => Promise<void>;
}

export function ScheduleCourtsManager({
  data,
  onRefresh,
}: ScheduleCourtsManagerProps) {
  const [newCourtName, setNewCourtName] = useState('');
  const [newCourtCode, setNewCourtCode] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'live' | 'finished'>('all');
  const [pullDrawerCourtId, setPullDrawerCourtId] = useState<number | null>(null);
  const [pullSourceFilter, setPullSourceFilter] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [pendingDeleteCourt, setPendingDeleteCourt] = useState<MasterCourt | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null
  );

  const courts: MasterCourt[] = data.masterCourts ?? [];
  const teamMap = useMemo(
    () => new Map<number, Team>((data.teams ?? []).map((t) => [t.id, t])),
    [data.teams]
  );
  const tournamentMap = useMemo(
    () =>
      new Map<number, Tournament>(
        (data.tournaments ?? []).map((t) => [t.id, t])
      ),
    [data.tournaments]
  );

  const notify = (type: 'ok' | 'err', msg: string) => {
    setFeedback({ type, msg });
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const playableMatches: Match[] = useMemo(() => {
    const raw = (data.matches ?? []).filter((m) => m.status !== 'bye');
    const filtered = raw.filter((m) => {
      if (categoryFilter !== 'all' && m.tournamentId !== categoryFilter) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      return true;
    });
    return groupMatchesByScheduleDay(filtered).orderedMatches;
  }, [data.matches, categoryFilter, statusFilter]);

  const maxRoundByTournament = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of data.matches ?? []) {
      if (m.bracketType !== 'main') continue;
      const cur = map.get(m.tournamentId) ?? 0;
      if (m.round > cur) map.set(m.tournamentId, m.round);
    }
    return map;
  }, [data.matches]);

  const handleAddCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCourtName.trim()) return;
    setBusy(true);
    try {
      await apiFetch('/api/admin/master-courts', {
        method: 'POST',
        body: JSON.stringify({
          name: newCourtName.trim(),
          shortCode: newCourtCode.trim() || undefined,
        }),
      });
      setNewCourtName('');
      setNewCourtCode('');
      await onRefresh();
      notify('ok', 'Lapangan baru ditambahkan ke Master Lapangan');
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateCourt = async (id: number, patch: Partial<MasterCourt>) => {
    try {
      await apiFetch(`/api/admin/master-courts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await onRefresh();
      notify('ok', 'Data lapangan diperbarui & disinkronkan');
    } catch (err) {
      notify('err', (err as Error).message);
    }
  };

  const handleDeleteCourt = (court: MasterCourt) => {
    setPendingDeleteCourt(court);
  };

  const confirmDeleteCourt = async () => {
    if (!pendingDeleteCourt) return;
    const court = pendingDeleteCourt;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/master-courts/${court.id}`, {
        method: 'DELETE',
      });
      setPendingDeleteCourt(null);
      await onRefresh();
      notify('ok', `"${court.name}" dihapus`);
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateMatchSchedule = async (
    matchId: number,
    fields: { courtName?: string; scheduledAt?: string }
  ) => {
    try {
      await apiFetch(`/api/admin/matches/${matchId}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      await onRefresh();
    } catch (err) {
      notify('err', (err as Error).message);
    }
  };

  const handleCopyTimePattern = async (
    targetCourtName: string,
    sourceCourtName: string
  ) => {
    const sourceMatches = playableMatches.filter(
      (m) => m.courtName === sourceCourtName && m.scheduledAt?.trim()
    );
    const timeSlots = sourceMatches.map((m) => m.scheduledAt!.trim());
    if (timeSlots.length === 0) {
      notify(
        'err',
        `${sourceCourtName} belum memiliki slot jam pertandingan untuk disalin`
      );
      return;
    }

    const targetMatches = playableMatches.filter(
      (m) => m.courtName === targetCourtName
    );
    if (targetMatches.length === 0) {
      notify(
        'err',
        `Tarik atau pindahkan minimal 1 pertandingan ke ${targetCourtName} terlebih dahulu`
      );
      return;
    }

    const updates = targetMatches
      .slice(0, timeSlots.length)
      .map((m, i) => ({
        matchId: m.id,
        scheduledAt: timeSlots[i],
      }));

    setBusy(true);
    try {
      await apiFetch('/api/admin/matches/bulk-schedule-assign', {
        method: 'POST',
        body: JSON.stringify({ updates }),
      });
      await onRefresh();
      notify(
        'ok',
        `${updates.length} pola jam dari ${sourceCourtName} disalin ke ${targetCourtName}`
      );
    } catch (err) {
      notify('err', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderMatchSummary = (m: Match) => {
    const cat = tournamentMap.get(m.tournamentId);
    const tA = m.teamAId ? teamMap.get(m.teamAId)?.name || 'TBD' : 'TBD';
    const tB = m.teamBId ? teamMap.get(m.teamBId)?.name || 'TBD' : 'TBD';
    const tr = maxRoundByTournament.get(m.tournamentId) ?? 3;
    const stageLbl = formatInternationalStageLabel(m, tr);
    return { cat, tA, tB, stageLbl };
  };

  return (
    <div className="animate-page-enter space-y-5">
      {/* Master Lapangan Section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                Master Lapangan &amp; Papan Jadwal Visual ({courts.length})
              </h2>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Kelola daftar lapangan resmi, lalu atur atau{' '}
                <strong>tarik jadwal antar-lapangan</strong> secara berdampingan dengan 1
                klik (mendukung salin pola jam dari Lapangan 1 ke Lapangan 2+).
              </p>
            </div>
          </div>

          <form onSubmit={handleAddCourt} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              required
              placeholder="Nama Lapangan (mis: Lapangan 3)"
              value={newCourtName}
              onChange={(e) => setNewCourtName(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="text"
              maxLength={12}
              placeholder="Kode (LAP 3)"
              value={newCourtCode}
              onChange={(e) => setNewCourtCode(e.target.value.toUpperCase())}
              className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold uppercase dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah
            </button>
          </form>
        </div>

        {/* Registered Courts Pills / Inline Rename */}
        <div className="mt-4 flex flex-wrap gap-2.5">
          {courts.map((ct) => {
            const countOnCourt = playableMatches.filter(
              (m) => m.courtName === ct.name
            ).length;
            return (
              <div
                key={ct.id}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-950"
              >
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-amber-800 dark:text-amber-300">
                  {ct.shortCode}
                </span>
                <input
                  type="text"
                  defaultValue={ct.name}
                  aria-label={`Ubah nama ${ct.name}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== ct.name) {
                      handleUpdateCourt(ct.id, { name: v });
                    }
                  }}
                  className="w-36 bg-transparent font-bold text-slate-900 focus:outline-none dark:text-white"
                />
                <span className="text-[11px] font-semibold text-slate-500">
                  ({countOnCourt} match)
                </span>
                {courts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteCourt(ct)}
                    aria-label={`Hapus ${ct.name}`}
                    title={`Hapus ${ct.name}`}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-500 sm:min-h-8 sm:min-w-8"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
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

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
            <CalendarClock className="h-4 w-4 text-amber-500" />
            Filter Pertandingan:
          </span>
          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(
                e.target.value === 'all' ? 'all' : Number(e.target.value)
              )
            }
            aria-label="Filter Kategori Jadwal"
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="all">Semua Kategori ({data.tournaments.length})</option>
            {data.tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as 'all' | 'scheduled' | 'live' | 'finished'
              )
            }
            aria-label="Filter Status Pertandingan"
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="all">Semua Status</option>
            <option value="scheduled">Terjadwal</option>
            <option value="live">Sedang Live</option>
            <option value="finished">Selesai</option>
          </select>
        </div>

        <span className="text-xs font-semibold text-slate-500">
          Total: <strong>{playableMatches.length}</strong> Pertandingan
        </span>
      </div>

      {/* Side-by-Side Visual Court Schedule Columns */}
      <div
        className={`grid gap-4 ${
          courts.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}
      >
        {courts.map((court) => {
          const courtMatches = playableMatches.filter(
            (m) => m.courtName === court.name
          );
          const otherMatches = playableMatches.filter(
            (m) =>
              m.courtName !== court.name &&
              (pullSourceFilter === 'all' || m.courtName === pullSourceFilter)
          );
          const otherCourts = courts.filter((c) => c.id !== court.id);
          const isPullOpen = pullDrawerCourtId === court.id;

          return (
            <div
              key={court.id}
              className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900"
            >
              {/* Court Column Header */}
              <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-amber-500 px-2 py-0.5 font-mono text-[11px] font-extrabold text-slate-950">
                        {court.shortCode}
                      </span>
                      <h3 className="font-display text-lg font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                        {court.name}
                      </h3>
                    </div>
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                      {courtMatches.length} Pertandingan Dijadwalkan
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setPullDrawerCourtId(isPullOpen ? null : court.id)
                      }
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
                        isPullOpen
                          ? 'bg-amber-500 text-slate-950'
                          : 'border border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500 hover:text-slate-950 dark:text-amber-300'
                      }`}
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      {isPullOpen ? 'Tutup Tarik Jadwal' : 'Tarik Jadwal'}
                    </button>

                    {otherCourts.length > 0 && (
                      <select
                        value=""
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.value) {
                            handleCopyTimePattern(court.name, e.target.value);
                          }
                        }}
                        aria-label={`Salin pola jam ke ${court.name}`}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 hover:border-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        <option value="">Salin Pola Jam...</option>
                        {otherCourts.map((oc) => (
                          <option key={oc.id} value={oc.name}>
                            Dari {oc.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Inline Pull / Take Matches From Other Courts Drawer */}
                {isPullOpen && (
                  <div className="mt-3 space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 dark:bg-amber-500/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                        <Copy className="h-3.5 w-3.5" />
                        Ambil Pertandingan ke {court.name}
                      </span>
                      <select
                        value={pullSourceFilter}
                        onChange={(e) => setPullSourceFilter(e.target.value)}
                        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="all">Dari Semua Lapangan Lain</option>
                        {otherCourts.map((oc) => (
                          <option key={oc.id} value={oc.name}>
                            Dari {oc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {otherMatches.length === 0 ? (
                      <p className="py-2 text-center text-[11px] text-slate-500">
                        Semua pertandingan sudah berada di {court.name} atau belum ada
                        jadwal lainnya.
                      </p>
                    ) : (
                      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                        {otherMatches.map((om) => {
                          const { cat, tA, tB, stageLbl } = renderMatchSummary(om);
                          return (
                            <div
                              key={om.id}
                              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-950"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-bold text-slate-900 dark:text-white">
                                  {tA} vs {tB}
                                </p>
                                <p className="truncate text-[10px] text-slate-500">
                                  {cat?.name} • {stageLbl} • Saat ini:{' '}
                                  <strong>{om.courtName}</strong>
                                  {om.scheduledAt ? ` (${om.scheduledAt})` : ''}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateMatchSchedule(om.id, {
                                    courtName: court.name,
                                  })
                                }
                                className="shrink-0 rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-extrabold text-slate-950 hover:bg-amber-400"
                              >
                                + Tarik
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Match Cards in This Court */}
              <div className="flex-1 space-y-2.5 p-4">
                {courtMatches.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500 dark:border-slate-800">
                    Belum ada pertandingan di <strong>{court.name}</strong>. Klik{' '}
                    <strong>Tarik Jadwal</strong> di atas untuk mengambil pertandingan.
                  </div>
                ) : (
                  courtMatches.map((m, idx) => {
                    const { cat, tA, tB, stageLbl } = renderMatchSummary(m);
                    return (
                      <div
                        key={m.id}
                        className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="font-bold text-amber-600 dark:text-amber-400">
                            #{idx + 1} • {cat?.name || 'Kategori'} • {stageLbl}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                              m.status === 'live'
                                ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                                : m.status === 'finished'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {m.status === 'live'
                              ? 'LIVE'
                              : m.status === 'finished'
                                ? `SELESAI (${m.setsWonA}-${m.setsWonB})`
                                : 'JADWAL'}
                          </span>
                        </div>

                        <p className="truncate font-bold text-slate-900 dark:text-white">
                          {tA} <span className="text-slate-400">vs</span> {tB}
                        </p>

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            defaultValue={m.scheduledAt || ''}
                            placeholder="Hari, Tgl • Jam WIB (mis: Jumat, 27 Nov • 13.00 - 14.00)"
                            onBlur={(e) => {
                              const val = e.target.value.trim();
                              if (val !== (m.scheduledAt || '')) {
                                handleUpdateMatchSchedule(m.id, {
                                  scheduledAt: val,
                                });
                              }
                            }}
                            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                          />
                          <select
                            value={m.courtName}
                            onChange={(e) => {
                              if (e.target.value !== m.courtName) {
                                handleUpdateMatchSchedule(m.id, {
                                  courtName: e.target.value,
                                });
                              }
                            }}
                            aria-label={`Pindah lapangan untuk ${tA} vs ${tB}`}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"
                          >
                            {courts.map((oc) => (
                              <option key={oc.id} value={oc.name}>
                                {oc.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDeleteCourt)}
        title="Hapus Lapangan?"
        message={
          pendingDeleteCourt
            ? `Hapus "${pendingDeleteCourt.name}" dari Master Lapangan? Pastikan pertandingan pada lapangan ini sudah dipindahkan jika perlu.`
            : ''
        }
        confirmLabel="Ya, Hapus Lapangan"
        busy={busy}
        onConfirm={confirmDeleteCourt}
        onCancel={() => setPendingDeleteCourt(null)}
      />
    </div>
  );
}

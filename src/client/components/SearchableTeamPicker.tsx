import { Check, ChevronDown, Plus, RotateCcw, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MASTER_TEAM_LEVEL_LABELS,
  isPlaceholderDrawSlotName,
  type MasterTeamLevel,
} from '../../shared/fivb-draw';
import { TeamAvatar } from './TeamAvatar';
import type { MasterTeam, Team } from '../types';

interface SearchableTeamPickerProps {
  slotTeam: Team;
  slotIndex: number;
  masterTeams: MasterTeam[];
  categoryTeams: Team[];
  onAssignMaster: (
    masterTeamId: number | null,
    options?: { squadLabel?: string }
  ) => Promise<void>;
  onQuickCreateMaster?: (name: string, school: string) => Promise<MasterTeam | null>;
}

export function SearchableTeamPicker({
  slotTeam,
  slotIndex,
  masterTeams,
  categoryTeams,
  onAssignMaster,
  onQuickCreateMaster,
}: SearchableTeamPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | MasterTeamLevel>('all');
  const [quickSchool, setQuickSchool] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const isPlaceholder = isPlaceholderDrawSlotName(slotTeam.name);

  // Map masterTeamId -> array of already-drawn slots in this category
  const drawnByMasterId = useMemo(() => {
    const map = new Map<
      number,
      Array<{ teamId: number; seed: number; squadLabel: string }>
    >();
    for (const tm of categoryTeams) {
      if (!tm.masterTeamId) continue;
      const arr = map.get(tm.masterTeamId) ?? [];
      arr.push({
        teamId: tm.id,
        seed: tm.seed,
        squadLabel: (tm.squadLabel || '').toUpperCase(),
      });
      map.set(tm.masterTeamId, arr);
    }
    return map;
  }, [categoryTeams]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 20);
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filteredMasters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return masterTeams.filter((mt) => {
      if (levelFilter !== 'all' && mt.level !== levelFilter) return false;
      if (!q) return true;
      return (
        mt.name.toLowerCase().includes(q) ||
        mt.school.toLowerCase().includes(q) ||
        mt.shortCode.toLowerCase().includes(q)
      );
    });
  }, [masterTeams, levelFilter, query]);

  const handleSelect = async (
    masterTeamId: number | null,
    squadLabel?: string
  ) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onAssignMaster(masterTeamId, { squadLabel });
      setOpen(false);
      setQuery('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickAdd = async () => {
    if (!onQuickCreateMaster || !query.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await onQuickCreateMaster(query.trim(), quickSchool.trim());
      if (created) {
        await onAssignMaster(created.id);
        setOpen(false);
        setQuery('');
        setQuickSchool('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
          isPlaceholder
            ? 'border-dashed border-amber-500/60 bg-amber-500/5 font-bold text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'
            : 'border-slate-200 bg-slate-50/80 font-bold text-slate-900 hover:border-amber-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white'
        }`}
      >
        <span className="truncate">
          {isPlaceholder
            ? `Pilih Tim Undian ${String(slotIndex + 1).padStart(2, '0')}...`
            : slotTeam.name}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-80 max-w-[88vw] rounded-2xl border border-slate-200 bg-white p-2.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          {/* Search Input */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ketik nama sekolah / kota..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2.5 text-xs font-semibold text-slate-900 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>

          {/* Mini Level Filter Pills */}
          <div className="mt-2 flex flex-wrap gap-1">
            {(
              [
                ['all', 'Semua'],
                ['smp', 'SMP'],
                ['sma', 'SMA'],
                ['kab_kota', 'Kab/Kota'],
                ['umum', 'Umum'],
              ] as const
            ).map(([lv, lbl]) => (
              <button
                key={lv}
                type="button"
                onClick={() => setLevelFilter(lv)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition ${
                  levelFilter === lv
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {lbl}
              </button>
            ))}

            {!isPlaceholder && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="ml-auto inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-500/20 dark:text-red-400"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                Kosongkan Slot
              </button>
            )}
          </div>

          {/* Scrollable Results List */}
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-0.5">
            {filteredMasters.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500 dark:bg-slate-950">
                Tidak ditemukan di Master Kontingen.
              </div>
            ) : (
              filteredMasters.map((mt) => {
                const drawnEntries = drawnByMasterId.get(mt.id) ?? [];
                const isCurrentSlot = drawnEntries.some(
                  (d) => d.teamId === slotTeam.id && !d.squadLabel
                );
                const alreadyMainInOtherSlot = drawnEntries.find(
                  (d) => d.teamId !== slotTeam.id && !d.squadLabel
                );
                const hasSquadB = drawnEntries.some((d) => d.squadLabel === 'B');

                return (
                  <div
                    key={mt.id}
                    className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-xs transition ${
                      isCurrentSlot
                        ? 'bg-amber-500/15 ring-1 ring-amber-500/40'
                        : alreadyMainInOtherSlot
                          ? 'bg-slate-50 opacity-75 dark:bg-slate-950/60'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={Boolean(alreadyMainInOtherSlot) || submitting}
                      onClick={() => handleSelect(mt.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                    >
                      <TeamAvatar team={mt} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-slate-900 dark:text-white">
                          {mt.name}
                        </p>
                        <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                          {mt.school || MASTER_TEAM_LEVEL_LABELS[mt.level]}
                          {alreadyMainInOtherSlot
                            ? ` • Slot #${String(alreadyMainInOtherSlot.seed).padStart(2, '0')}`
                            : ''}
                        </p>
                      </div>
                    </button>

                    {isCurrentSlot ? (
                      <Check className="h-4 w-4 shrink-0 text-amber-500" />
                    ) : alreadyMainInOtherSlot && !hasSquadB ? (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleSelect(mt.id, 'B')}
                        title="Masukkan sebagai Tim B dari sekolah/kontingen ini"
                        className="shrink-0 rounded-lg border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[10px] font-extrabold text-amber-700 hover:bg-amber-500 hover:text-slate-950 dark:text-amber-300"
                      >
                        + Tim B
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {/* Quick Inline Create in Master if typing a brand-new team during TM */}
          {onQuickCreateMaster && query.trim().length >= 3 && (
            <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={quickSchool}
                  onChange={(e) => setQuickSchool(e.target.value)}
                  placeholder="Kota/Kab (opsional)"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleQuickAdd}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950"
                >
                  <Plus className="h-3 w-3" />
                  Simpan Baru ke Master
                </button>
              </div>
              <p className="flex items-center gap-1 text-[10px] text-slate-400">
                <Users className="h-3 w-3" />
                Menyimpan &ldquo;{query.trim()}&rdquo; ke Master &amp; mengisi slot ini
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

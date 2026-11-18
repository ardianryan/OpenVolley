import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Tournament } from '../types';

interface ConfirmDeleteCategoryModalProps {
  tournament: Tournament;
  teamCount: number;
  matchCount: number;
  reportCount: number;
  deleting: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmDeleteCategoryModal({
  tournament,
  teamCount,
  matchCount,
  reportCount,
  deleting,
  onConfirm,
  onClose,
}: ConfirmDeleteCategoryModalProps) {
  const [isClosing, setIsClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (deleting) return;
    setIsClosing((prev) => {
      if (prev) return prev;
      window.setTimeout(() => {
        onClose();
      }, 180);
      return true;
    });
  }, [deleting, onClose]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [requestClose]);

  return (
    <div
      onClick={requestClose}
      className={`fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 backdrop-blur-sm sm:items-center sm:p-4 ${
        isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="del-cat-title"
        aria-describedby="del-cat-desc"
        onClick={(e) => e.stopPropagation()}
        className={`w-full rounded-t-3xl border border-slate-200 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-2xl sm:pb-5 dark:border-slate-800 dark:bg-slate-900 ${
          isClosing ? 'animate-sheet-down' : 'animate-sheet-up'
        }`}
      >
        {/* Mobile Bottom-Sheet Drag Handle */}
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700" />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/15 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="del-cat-title"
                className="font-display text-lg font-extrabold uppercase tracking-wide text-slate-900 dark:text-white"
              >
                Hapus Kategori Pertandingan?
              </h3>
              <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                {tournament.name}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={deleting}
            onClick={requestClose}
            aria-label="Tutup konfirmasi"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          id="del-cat-desc"
          className="mt-4 space-y-3 rounded-2xl border border-red-500/25 bg-red-500/8 p-4 text-xs text-slate-700 dark:border-red-500/30 dark:bg-red-950/25 dark:text-slate-200"
        >
          <p className="leading-relaxed font-semibold">
            Menghapus kategori <strong>{tournament.name}</strong> akan menghapus secara permanen seluruh data di bawahnya:
          </p>
          <ul className="space-y-1.5 pl-4 list-disc font-medium text-slate-700 dark:text-slate-300">
            <li>
              <strong>{teamCount} tim terdaftar</strong> beserta nama sekolah &amp; logo tim
            </li>
            <li>
              <strong>{matchCount} pertandingan</strong> beserta bagan, jadwal lapangan, &amp; seluruh riwayat skor set/hasil pemenang
            </li>
            {reportCount > 0 && (
              <li>
                <strong>{reportCount} unggahan Galeri Momen</strong> (foto/slide/video) pada kategori ini
              </li>
            )}
          </ul>
          <p className="pt-0.5 text-[11px] font-bold text-red-700 dark:text-red-400">
            Perhatian: Tindakan ini tidak dapat dibatalkan setelah dikonfirmasi.
          </p>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={deleting}
            onClick={requestClose}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onConfirm}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            <span>{deleting ? 'Menghapus Kategori...' : 'Ya, Hapus Permanen'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

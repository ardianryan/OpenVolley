import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Home,
  Lock,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
  WifiOff,
  Wrench,
} from 'lucide-react';
import type { SupportedErrorCode } from '../../shared/routes';
import { ThemeToggle } from './ThemeToggle';
import { VolleyballIcon } from './VolleyballIcon';

interface ErrorPageProps {
  code: SupportedErrorCode;
  customMessage?: string;
  retryAfterSec?: number;
  onRetry?: () => void;
  primaryActionLabel?: string;
  primaryActionHref?: string;
  onPrimaryAction?: () => void;
}

interface ErrorDescriptor {
  badge: string;
  title: string;
  description: string;
  accentClass: string;
  icon: typeof AlertTriangle;
}

const ERROR_CATALOG: Record<SupportedErrorCode, ErrorDescriptor> = {
  400: {
    badge: 'ERROR 400 • BAD REQUEST',
    title: 'Permintaan Tidak Valid',
    description:
      'Format data atau parameter yang dikirimkan tidak sesuai. Silakan periksa kembali isian Anda lalu ulangi.',
    accentClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
    icon: AlertTriangle,
  },
  401: {
    badge: 'ERROR 401 • UNAUTHORIZED',
    title: 'Sesi Masuk Diperlukan',
    description:
      'Halaman ini memerlukan autentikasi akun Panitia, Admin, atau Tim Media yang aktif. Silakan masuk terlebih dahulu.',
    accentClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
    icon: Lock,
  },
  403: {
    badge: 'ERROR 403 • FORBIDDEN',
    title: 'Akses Halaman Dibatasi',
    description:
      'Akun Anda tidak memiliki izin role untuk membuka menu ini. Gunakan menu sesuai hak akses Anda atau hubungi Admin Utama.',
    accentClass: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/35',
    icon: ShieldAlert,
  },
  404: {
    badge: 'ERROR 404 • OUT OF BOUNDS',
    title: 'Halaman Tidak Ditemukan',
    description:
      'Bola keluar garis lapangan! Alamat halaman yang Anda tuju tidak tersedia atau sudah dipindahkan.',
    accentClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
    icon: AlertTriangle,
  },
  408: {
    badge: 'ERROR 408 • REQUEST TIMEOUT',
    title: 'Waktu Koneksi Habis',
    description:
      'Server membutuhkan waktu terlalu lama untuk merespons karena sinyal tidak stabil. Silakan coba muat ulang.',
    accentClass: 'bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-500/35',
    icon: Clock,
  },
  429: {
    badge: 'ERROR 429 • RATE LIMITED',
    title: 'Terlalu Banyak Permintaan',
    description:
      'Sistem keamanan membatasi percobaan berulang dari jaringan Anda untuk mencegah penyalahgunaan. Tunggu sebentar lalu coba kembali.',
    accentClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
    icon: Clock,
  },
  500: {
    badge: 'ERROR 500 • SERVER ERROR',
    title: 'Gangguan Internal Sistem',
    description:
      'Terjadi kendala tak terduga saat memproses halaman ini. Tim teknis dapat memeriksa log server, atau silakan muat ulang halaman.',
    accentClass: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/35',
    icon: ServerCrash,
  },
  502: {
    badge: 'ERROR 502 • BAD GATEWAY',
    title: 'Jalur Server Sedang Terganggu',
    description:
      'Proxy atau gerbang jaringan belum berhasil terhubung ke server aplikasi utama. Tunggu beberapa detik lalu muat ulang.',
    accentClass: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/35',
    icon: ServerCrash,
  },
  503: {
    badge: 'ERROR 503 • SERVICE UNAVAILABLE',
    title: 'Layanan Sedang Pemeliharaan',
    description:
      'Portal pertandingan sedang dalam pemeliharaan singkat atau penyesuaian kapasitas arena. Skor dan jadwal akan segera kembali aktif.',
    accentClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
    icon: Wrench,
  },
  offline: {
    badge: 'JARINGAN TERPUTUS • OFFLINE',
    title: 'Tidak Ada Koneksi Internet',
    description:
      'Perangkat Anda sedang tidak terhubung ke internet. Periksa Wi-Fi atau paket data seluler Anda lalu ketuk Coba Lagi.',
    accentClass: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/35',
    icon: WifiOff,
  },
};

export function ErrorPage({
  code,
  customMessage,
  retryAfterSec,
  onRetry,
  primaryActionLabel,
  primaryActionHref = '/',
  onPrimaryAction,
}: ErrorPageProps) {
  const info = ERROR_CATALOG[code] ?? ERROR_CATALOG[500];
  const StatusIcon = info.icon;
  const displayCode = code === 'offline' ? 'OFFLINE' : String(code);

  const defaultPrimaryHref = code === 401 ? '/back-office' : primaryActionHref;
  const defaultPrimaryText =
    primaryActionLabel ||
    (code === 401 ? 'Masuk ke Panel Panitia' : 'Kembali ke Beranda Skor');

  return (
    <div className="court-pattern relative flex min-h-screen flex-col justify-between overflow-hidden px-4 py-6">
      {/* Top Minimal Header */}
      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-2.5 rounded-xl pr-2 transition hover:opacity-90"
        >
          <img
            src="/brand/svc-crest-color.svg"
            alt="Logo SVC"
            className="h-10 w-10 object-contain"
          />
          <div>
            <p className="font-display text-base font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
              SVC • AVERSA
            </p>
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
              Volleyball Sport Center
            </p>
          </div>
        </a>

        <ThemeToggle />
      </header>

      {/* Center Broadcast Error Stage */}
      <main className="animate-page-enter relative z-10 mx-auto my-8 w-full max-w-xl">
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-2xl sm:p-9 dark:border-slate-800 dark:bg-slate-900">
          <img
            src="/brand/svc-net-official.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -left-4 -top-4 h-36 w-36 object-contain opacity-15"
          />
          <img
            src="/brand/svc-spiker-official.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-4 right-2 h-40 w-32 object-contain opacity-10"
          />

          <div className="relative z-10 flex flex-col items-center">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider ${info.accentClass}`}
            >
              <StatusIcon className="h-3.5 w-3.5 shrink-0" />
              {info.badge}
            </span>

            {/* Giant Sport Scoreboard Code Display */}
            <div className="mt-5 flex items-center justify-center gap-3">
              <VolleyballIcon className="h-10 w-10 text-amber-600 sm:h-12 sm:w-12 dark:text-amber-400" />
              <span className="gold-gradient-text font-display text-6xl font-extrabold leading-none tracking-tight tabular-nums sm:text-8xl">
                {displayCode}
              </span>
            </div>

            <h1 className="mt-3 font-display text-2xl font-extrabold uppercase tracking-wide text-slate-900 sm:text-3xl dark:text-white">
              {info.title}
            </h1>

            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {customMessage || info.description}
            </p>

            {retryAfterSec && retryAfterSec > 0 && (
              <p className="mt-3 rounded-xl bg-amber-500/12 px-3.5 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                Silakan coba kembali dalam ~{retryAfterSec} detik.
              </p>
            )}

            {/* Recovery Actions (>= 44px touch targets) */}
            <div className="mt-6 flex w-full flex-col justify-center gap-2.5 sm:flex-row">
              {onPrimaryAction ? (
                <button
                  type="button"
                  onClick={onPrimaryAction}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-extrabold uppercase tracking-wider text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"
                >
                  <Home className="h-4 w-4" />
                  {defaultPrimaryText}
                </button>
              ) : (
                <a
                  href={defaultPrimaryHref}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-extrabold uppercase tracking-wider text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"
                >
                  <Home className="h-4 w-4" />
                  {defaultPrimaryText}
                </a>
              )}

              {(onRetry || code === 408 || code === 429 || code === 500 || code === 502 || code === 503 || code === 'offline') && (
                <button
                  type="button"
                  onClick={() => {
                    if (onRetry) onRetry();
                    else window.location.reload();
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-800 transition hover:border-amber-600 hover:text-amber-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-amber-400 dark:hover:text-amber-300"
                >
                  <RefreshCw className="h-4 w-4" />
                  Coba Muat Ulang
                </button>
              )}

              {code === 404 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.history.length > 1) window.history.back();
                    else window.location.href = '/';
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-800 transition hover:border-amber-600 hover:text-amber-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-amber-400 dark:hover:text-amber-300"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Halaman Sebelumnya
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 text-center text-xs text-slate-600 dark:text-slate-400">
        Smansage Volleyball Competition • AVERSA Dies Natalis 44 SMA Negeri 1 Gedeg
      </footer>
    </div>
  );
}

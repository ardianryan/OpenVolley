import { Download, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean(nav.standalone)
  );
}

function detectIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIos && !detectStandalone();
}

export function PwaInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(detectStandalone);
  const [isIos] = useState<boolean>(detectIosSafari);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [closingGuide, setClosingGuide] = useState(false);

  const closeGuide = useCallback(() => {
    setClosingGuide(true);
    window.setTimeout(() => {
      setShowIosGuide(false);
      setClosingGuide(false);
    }, 190);
  }, []);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!showIosGuide) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGuide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showIosGuide, closeGuide]);

  if (isInstalled || (!deferredPrompt && !isIos)) {
    return null;
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
      return;
    }
    if (isIos) {
      setShowIosGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        aria-label="Install aplikasi SVC Voli ke layar utama"
        title="Install aplikasi agar lebih ringan & cepat diakses"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-amber-600/40 bg-amber-500/15 px-3 py-2 text-xs font-extrabold text-amber-800 transition hover:bg-amber-500/25 sm:min-h-9 sm:py-1.5 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25"
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden md:inline">Install Aplikasi</span>
        <span className="md:hidden">Install</span>
      </button>

      {showIosGuide && (
        <div
          onClick={closeGuide}
          className={`fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-4 backdrop-blur-xs sm:items-center ${
            closingGuide ? 'animate-backdrop-out' : 'animate-backdrop-in'
          }`}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-ios-title"
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 ${
              closingGuide ? 'animate-sheet-down' : 'animate-sheet-up'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h3
                    id="pwa-ios-title"
                    className="font-display text-lg font-extrabold uppercase tracking-wide text-slate-900 dark:text-white"
                  >
                    Install Aplikasi SVC Voli
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Akses skor real-time lebih ringan dari Layar Utama
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeGuide}
                aria-label="Tutup panduan install"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ol className="mt-4 space-y-3 text-xs text-slate-700 dark:text-slate-300">
              <li className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
                <Share className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                <span>
                  1. Ketuk tombol <strong>Bagikan (Share)</strong> di bilah bawah browser Safari.
                </span>
              </li>
              <li className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
                <PlusSquare className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                <span>
                  2. Pilih <strong>Tambah ke Layar Utama (Add to Home Screen)</strong> lalu ketuk{' '}
                  <strong>Tambah</strong>.
                </span>
              </li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}

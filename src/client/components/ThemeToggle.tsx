import { Monitor, Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  type StoredTheme,
  formatThemeModeLabel,
  getNextThemeOverride,
  resolveThemeDark,
} from '../../shared/theme-cycle';

function getStoredOverride(): StoredTheme {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('ov_theme');
  return raw === 'light' || raw === 'dark' ? raw : null;
}

function getSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyThemeToDom(dark: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.getElementById('ov-theme-color');
  if (meta) {
    meta.setAttribute('content', dark ? '#0b0f19' : '#f8fafc');
  }
}

export function ThemeToggle() {
  const [override, setOverride] = useState<StoredTheme>(getStoredOverride);
  const [systemDark, setSystemDark] = useState<boolean>(getSystemDark);

  const syncState = useCallback((nextOverride: StoredTheme) => {
    const curSystemDark = getSystemDark();
    const nextDark = resolveThemeDark(nextOverride, curSystemDark);
    setOverride(nextOverride);
    setSystemDark(curSystemDark);
    applyThemeToDom(nextDark);
  }, []);

  useEffect(() => {
    syncState(getStoredOverride());

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      syncState(getStoredOverride());
    };

    const handleExternalSync = () => {
      syncState(getStoredOverride());
    };

    mq.addEventListener('change', handleSystemChange);
    window.addEventListener('ov-theme-change', handleExternalSync);
    window.addEventListener('storage', handleExternalSync);
    return () => {
      mq.removeEventListener('change', handleSystemChange);
      window.removeEventListener('ov-theme-change', handleExternalSync);
      window.removeEventListener('storage', handleExternalSync);
    };
  }, [syncState]);

  const handleToggle = () => {
    const curSystemDark = getSystemDark();
    const nextOverride = getNextThemeOverride(override, curSystemDark);

    if (nextOverride === null) {
      localStorage.removeItem('ov_theme');
    } else {
      localStorage.setItem('ov_theme', nextOverride);
    }

    syncState(nextOverride);
    window.dispatchEvent(new Event('ov-theme-change'));
  };

  const currentLabel = formatThemeModeLabel(override, systemDark);
  const nextOverride = getNextThemeOverride(override, systemDark);
  const nextLabel = formatThemeModeLabel(nextOverride, systemDark);

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={`Tema saat ini: ${currentLabel}. Klik untuk beralih ke ${nextLabel}.`}
      title={`Tema: ${currentLabel} • Klik → ${nextLabel}`}
      className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-800 shadow-xs transition hover:border-amber-600 hover:text-amber-800 sm:h-9 sm:w-9 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-amber-400 dark:hover:text-amber-300"
    >
      {/* State 1: Default Sistem */}
      <Monitor
        className={`h-4 w-4 transition-all duration-300 ${
          override === null
            ? 'scale-100 rotate-0 opacity-100 text-amber-700 dark:text-amber-400'
            : 'pointer-events-none absolute scale-50 -rotate-45 opacity-0'
        }`}
      />
      {/* State 2/3: Explicit Light */}
      <Sun
        className={`h-4 w-4 transition-all duration-300 ${
          override === 'light'
            ? 'scale-100 rotate-0 opacity-100 text-amber-600'
            : 'pointer-events-none absolute scale-50 -rotate-90 opacity-0'
        }`}
      />
      {/* State 2/3: Explicit Dark */}
      <Moon
        className={`h-4 w-4 transition-all duration-300 ${
          override === 'dark'
            ? 'scale-100 rotate-0 opacity-100 text-amber-300'
            : 'pointer-events-none absolute scale-50 rotate-90 opacity-0'
        }`}
      />
    </button>
  );
}

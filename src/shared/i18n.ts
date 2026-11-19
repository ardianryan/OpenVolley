export type LocaleCode = 'id' | 'en';

export const DICTIONARY = {
  id: {
    nav_live: 'Skor Langsung',
    nav_bracket: 'Bagan & Klasemen',
    nav_gallery: 'Galeri Momen',
    nav_tv: 'Layar Skor TV',
    nav_staff: 'Panel Panitia',
    status_live: 'BERLANGSUNG',
    status_scheduled: 'TERJADWAL',
    status_finished: 'SELESAI',
    filter_all: 'Semua',
    filter_live: 'Live',
    filter_scheduled: 'Jadwal',
    filter_finished: 'Selesai',
    label_set: 'Set',
    label_timeout: 'Time-Out',
    label_sub: 'Substitusi',
    label_serve: 'Servis',
    label_winner: 'Pemenang',
    obs_access_denied: 'Akses OBS Ditolak (Token Tidak Valid)',
    obs_loading: 'Memuat Overlay Siaran...',
    language_label: 'Bahasa',
  },
  en: {
    nav_live: 'Live Scores',
    nav_bracket: 'Bracket & Standings',
    nav_gallery: 'Moment Gallery',
    nav_tv: 'Arena TV Display',
    nav_staff: 'Staff Panel',
    status_live: 'LIVE',
    status_scheduled: 'SCHEDULED',
    status_finished: 'FINISHED',
    filter_all: 'All',
    filter_live: 'Live',
    filter_scheduled: 'Upcoming',
    filter_finished: 'Finished',
    label_set: 'Set',
    label_timeout: 'Timeout',
    label_sub: 'Substitution',
    label_serve: 'Serve',
    label_winner: 'Winner',
    obs_access_denied: 'OBS Access Denied (Invalid Token)',
    obs_loading: 'Loading Broadcast Overlay...',
    language_label: 'Language',
  },
} as const;

export type TranslationKey = keyof typeof DICTIONARY.id;

export function normalizeLocale(raw?: string | null): LocaleCode {
  return raw === 'en' ? 'en' : 'id';
}

export function translate(locale: LocaleCode, key: TranslationKey): string {
  return DICTIONARY[locale]?.[key] ?? DICTIONARY.id[key];
}

export function getStoredLocale(fallback: LocaleCode = 'id'): LocaleCode {
  if (typeof window === 'undefined') return fallback;
  const saved = window.localStorage.getItem('ov_locale');
  return saved === 'en' || saved === 'id' ? saved : fallback;
}

export function setStoredLocale(locale: LocaleCode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('ov_locale', locale);
}

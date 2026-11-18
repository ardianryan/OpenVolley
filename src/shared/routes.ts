export type SupportedErrorCode =
  | 400
  | 401
  | 403
  | 404
  | 408
  | 429
  | 500
  | 502
  | 503
  | 'offline';

const EXACT_SPA_PATHS = new Set([
  '/',
  '/live',
  '/bagan',
  '/galeri',
  '/tv',
  '/back-office',
  '/back-office/beranda',
  '/back-office/operator',
  '/back-office/bagan',
  '/back-office/dokumen',
  '/back-office/media',
  '/back-office/branding',
  '/back-office/akun',
]);

const ERROR_CODE_MAP: Record<string, SupportedErrorCode> = {
  '400': 400,
  '401': 401,
  '403': 403,
  '404': 404,
  '408': 408,
  '429': 429,
  '500': 500,
  '502': 502,
  '503': 503,
  offline: 'offline',
};

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

export function parseExplicitErrorRoute(pathname: string): SupportedErrorCode | null {
  const clean = normalizePathname(pathname).toLowerCase();
  if (!clean.startsWith('/error/')) return null;
  const seg = clean.slice('/error/'.length);
  return ERROR_CODE_MAP[seg] ?? null;
}

export function isKnownSpaPath(pathname: string): boolean {
  const clean = normalizePathname(pathname);
  if (EXACT_SPA_PATHS.has(clean)) return true;
  if (parseExplicitErrorRoute(clean) !== null) return true;
  return false;
}

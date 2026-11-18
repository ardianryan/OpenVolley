import {
  ArrowUpRight,
  BarChart3,
  Camera,
  ExternalLink,
  GitBranch,
  Home,
  LayoutGrid,
  LogOut,
  Monitor,
  Palette,
  Radio,
  Shield,
  Trophy,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SupportedErrorCode } from '../../shared/routes';
import { ErrorPage } from '../components/ErrorPage';
import { ThemeToggle } from '../components/ThemeToggle';
import { VolleyballIcon } from '../components/VolleyballIcon';
import { ApiError, apiFetch } from '../lib/api';
import type { AuthUser, OverviewData } from '../types';
import { AdminDashboard } from './AdminDashboard';
import { LiveOperator } from './LiveOperator';
import { MediaStudio } from './MediaStudio';

type BackOfficeSection =
  | 'overview'
  | 'operator'
  | 'tournaments'
  | 'branding'
  | 'users'
  | 'media';

const SECTION_TO_PATH: Record<BackOfficeSection, string> = {
  overview: '/back-office/beranda',
  operator: '/back-office/operator',
  tournaments: '/back-office/bagan',
  media: '/back-office/media',
  branding: '/back-office/branding',
  users: '/back-office/akun',
};

const PATH_TO_SECTION: Record<string, BackOfficeSection> = {
  '/back-office/beranda': 'overview',
  '/back-office/operator': 'operator',
  '/back-office/bagan': 'tournaments',
  '/back-office/media': 'media',
  '/back-office/branding': 'branding',
  '/back-office/akun': 'users',
};

const SECTION_ALLOWED_ROLES: Record<BackOfficeSection, Array<AuthUser['role']>> = {
  overview: ['admin', 'panitia'],
  operator: ['admin', 'panitia'],
  tournaments: ['admin', 'panitia'],
  media: ['admin', 'media'],
  branding: ['admin'],
  users: ['admin'],
};

function getInitialSection(role?: AuthUser['role']): BackOfficeSection {
  if (typeof window !== 'undefined') {
    const cleanPath = window.location.pathname.replace(/\/+$/, '');
    const fromPath = PATH_TO_SECTION[cleanPath];
    if (fromPath) {
      return fromPath;
    }
    const saved = localStorage.getItem('ov_bo_section') as BackOfficeSection | null;
    if (saved && saved in SECTION_TO_PATH) {
      if (!role || SECTION_ALLOWED_ROLES[saved].includes(role)) {
        return saved;
      }
    }
  }
  return role === 'media' ? 'media' : 'overview';
}

export function BackOffice() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loadError, setLoadError] = useState<SupportedErrorCode | null>(null);
  const [section, setSectionState] = useState<BackOfficeSection>(() => getInitialSection());

  const setSection = useCallback((next: BackOfficeSection) => {
    setSectionState(next);
    localStorage.setItem('ov_bo_section', next);
    const targetPath = SECTION_TO_PATH[next];
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const fromPath = PATH_TO_SECTION[window.location.pathname];
      if (fromPath) setSectionState(fromPath);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const loadData = useCallback(async (u: AuthUser) => {
    try {
      setLoadError(null);
      const endpoint =
        u.role === 'media' ? '/api/public/overview' : '/api/admin/overview';
      const res = await apiFetch<OverviewData>(endpoint);
      setData(res);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 0) setLoadError('offline');
        else if (err.status === 403) setLoadError(403);
        else if (err.status === 429) setLoadError(429);
        else if (err.status === 502) setLoadError(502);
        else if (err.status === 503) setLoadError(503);
        else setLoadError(500);
      } else {
        setLoadError(500);
      }
    }
  }, []);

  useEffect(() => {
    apiFetch<{ user: AuthUser }>('/api/auth/me')
      .then(async (res) => {
        setUser(res.user);
        const cleanPath = window.location.pathname.replace(/\/+$/, '');
        if (cleanPath === '/back-office') {
          setSection(getInitialSection(res.user.role));
        } else if (cleanPath in PATH_TO_SECTION) {
          setSectionState(PATH_TO_SECTION[cleanPath]);
        }
        await loadData(res.user);
      })
      .catch(() => {
        apiFetch<OverviewData>('/api/public/overview')
          .then(setData)
          .catch(() => {});
      })
      .finally(() => setCheckingAuth(false));
  }, [loadData]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setUser(res.user);
      setSection(getInitialSection(res.user.role));
      await loadData(res.user);
    } catch (err) {
      setLoginError((err as Error).message);
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950 lg:flex lg:gap-6 lg:p-6">
        <div className="hidden w-64 shrink-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:block">
          <div className="skeleton-shimmer h-12 rounded-xl" />
          <div className="skeleton-shimmer h-9 rounded-xl" />
          <div className="skeleton-shimmer h-9 rounded-xl" />
          <div className="skeleton-shimmer h-9 rounded-xl" />
        </div>
        <div className="flex-1 space-y-5">
          <div className="skeleton-shimmer h-32 rounded-2xl" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton-shimmer h-24 rounded-2xl" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="skeleton-shimmer h-44 rounded-2xl" />
            <div className="skeleton-shimmer h-44 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="court-pattern flex min-h-screen flex-col items-center justify-center p-4">
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Portal Publik
          </a>
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex flex-col items-center text-center">
            <img
              src={data?.settings?.logoUrl || '/brand/svc-crest-color.svg'}
              alt="SVC Logo"
              className="h-16 w-16 object-contain"
            />
            <h1 className="mt-3 font-display text-2xl font-extrabold uppercase tracking-wide">
              Back-Office Panitia
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {data?.settings?.eventName || 'Smansage Volleyball Competition'} • AVERSA
            </p>
          </div>

          {loginError && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                Username
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin / panitia / media"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              className="mt-2 w-full rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"
            >
              Masuk ke Panel
            </button>
          </form>
        </div>
      </div>
    );
  }

  const navItems: Array<{
    id: BackOfficeSection;
    label: string;
    shortLabel: string;
    icon: typeof Radio;
    roles: AuthUser['role'][];
  }> = [
    {
      id: 'overview',
      label: 'Beranda',
      shortLabel: 'Beranda',
      icon: Home,
      roles: ['admin', 'panitia'],
    },
    {
      id: 'operator',
      label: 'Live Operator',
      shortLabel: 'Skor',
      icon: Radio,
      roles: ['admin', 'panitia'],
    },
    {
      id: 'tournaments',
      label: 'Kategori & Bagan',
      shortLabel: 'Bagan',
      icon: GitBranch,
      roles: ['admin', 'panitia'],
    },
    {
      id: 'media',
      label: 'Media Studio',
      shortLabel: 'Media',
      icon: Camera,
      roles: ['admin', 'media'],
    },
    {
      id: 'branding',
      label: 'Branding & Logo',
      shortLabel: 'Brand',
      icon: Palette,
      roles: ['admin'],
    },
    {
      id: 'users',
      label: 'Manajemen Akun',
      shortLabel: 'Akun',
      icon: Users,
      roles: ['admin'],
    },
  ];

  const allowedNav = navItems.filter((item) => item.roles.includes(user.role));
  const defaultRoleSection: BackOfficeSection =
    user.role === 'media' ? 'media' : 'overview';

  // Enforce 403 Forbidden page if user navigates directly to a Back-Office URL outside their role
  if (!SECTION_ALLOWED_ROLES[section].includes(user.role)) {
    return (
      <ErrorPage
        code={403}
        customMessage={`Akun Anda (${user.role.toUpperCase()}) tidak memiliki izin untuk membuka halaman ini. Silakan kembali ke menu kerja yang sesuai dengan role Anda.`}
        primaryActionLabel="Buka Menu Role Saya"
        onPrimaryAction={() => setSection(defaultRoleSection)}
      />
    );
  }

  if (!data && loadError) {
    return (
      <ErrorPage
        code={loadError}
        onRetry={() => loadData(user)}
      />
    );
  }

  // Stats for Overview
  const liveMatches = (data?.matches ?? []).filter((m) => m.status === 'live');
  const finishedMatches = (data?.matches ?? []).filter((m) => m.status === 'finished');
  const totalTeams = data?.teams.length ?? 0;
  const totalReports = data?.reports.length ?? 0;
  const activeCategories = (data?.tournaments ?? []).filter((t) => t.isEnabled).length;

  // Gojek-style quick action tiles for mobile & overview
  const quickActions: Array<{
    title: string;
    subtitle: string;
    icon: typeof Radio;
    colorClass: string;
    onClick: () => void;
    visible: boolean;
  }> = [
    {
      title: 'Skor Live',
      subtitle: 'Operator lapangan',
      icon: Radio,
      colorClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
      onClick: () => setSection('operator'),
      visible: user.role !== 'media',
    },
    {
      title: 'Bagan & Undian',
      subtitle: 'Atur 16 / 8 tim',
      icon: GitBranch,
      colorClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      onClick: () => setSection('tournaments'),
      visible: user.role !== 'media',
    },
    {
      title: 'Media Studio',
      subtitle: 'Poster & Video 18s',
      icon: Camera,
      colorClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
      onClick: () => setSection('media'),
      visible: user.role === 'admin' || user.role === 'media',
    },
    {
      title: 'Branding SVC',
      subtitle: 'Logo & teks acara',
      icon: Palette,
      colorClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
      onClick: () => setSection('branding'),
      visible: user.role === 'admin',
    },
    {
      title: 'Kelola Akun',
      subtitle: 'Panitia & media',
      icon: Users,
      colorClass: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
      onClick: () => setSection('users'),
      visible: user.role === 'admin',
    },
    {
      title: 'Layar TV Arena',
      subtitle: 'Proyektor skor',
      icon: Monitor,
      colorClass: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
      onClick: () => {
        window.open('/tv', '_blank', 'noopener,noreferrer');
      },
      visible: true,
    },
    {
      title: 'Portal Publik',
      subtitle: 'Lihat live view',
      icon: ExternalLink,
      colorClass: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
      onClick: () => {
        window.location.href = '/';
      },
      visible: true,
    },
  ].filter((q) => q.visible);

  const roleLabel =
    user.role === 'admin'
      ? 'Admin'
      : user.role === 'panitia'
        ? 'Panitia'
        : 'Tim Media';
  const currentNav = allowedNav.find((n) => n.id === section);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 lg:flex">
      {/* DESKTOP FLOATING STICKY SIDEBAR */}
      <aside className="hidden w-64 shrink-0 flex-col justify-between overflow-hidden border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 lg:sticky lg:top-4 lg:my-4 lg:ml-4 lg:flex lg:h-[calc(100vh-2rem)] lg:rounded-2xl">
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Brand Header */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <img
              src={data?.settings?.logoUrl || '/brand/svc-crest-color.svg'}
              alt="Logo SVC"
              className="h-10 w-10 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="truncate font-display text-base font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                SVC • AVERSA
              </p>
              <p className="truncate text-xs font-semibold text-amber-800 dark:text-amber-400">
                Back-Office Panel
              </p>
            </div>
          </div>

          {/* Sidebar Navigation */}
          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {allowedNav.map((item) => {
              const Icon = item.icon;
              const isActive = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-xs font-bold transition ${
                    isActive
                      ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/20'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Profile */}
        <div className="space-y-3 border-t border-slate-100 p-4 dark:border-slate-800">
          <a
            href="/"
            className="flex min-h-10 items-center justify-between rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-800 transition hover:border-amber-600 hover:text-amber-800 dark:border-slate-800 dark:text-slate-300 dark:hover:border-amber-400 dark:hover:text-amber-300"
          >
            <span className="flex items-center gap-2">
              <VolleyballIcon className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
              Lihat Portal Publik
            </span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>

          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-100 p-2.5 dark:bg-slate-950">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 font-display text-sm font-extrabold text-slate-950">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-900 dark:text-white">
                  {user.name}
                </p>
                <p className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                  {roleLabel}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Keluar sesi"
              title="Keluar"
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-500/10 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN WORKSPACE */}
      <div className="flex min-w-0 flex-1 flex-col pb-28 lg:pb-10">
        {/* Top Bar (Desktop & Mobile) */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90 lg:mx-6 lg:mt-4 lg:rounded-2xl lg:border lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={data?.settings?.logoUrl || '/brand/svc-crest-color.svg'}
              alt="Logo"
              className="h-8 w-8 shrink-0 object-contain lg:hidden"
            />
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                {currentNav?.label || 'Dashboard'}
              </h1>
              <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                Halo,{' '}
                <span className="font-semibold text-amber-800 dark:text-amber-400">
                  {user.name}
                </span>{' '}
                ({roleLabel})
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {liveMatches.length > 0 && (
              <button
                type="button"
                onClick={() => setSection('operator')}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-700 sm:min-h-8 dark:text-red-400"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                {liveMatches.length} LIVE
              </button>
            )}
            <ThemeToggle />
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Keluar akun"
              title="Keluar"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-300 text-slate-700 hover:border-red-500/50 hover:text-red-600 dark:border-slate-700 dark:text-slate-300 lg:hidden"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Content Body */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-5 lg:px-6">
          {!data ? (
            <div className="animate-page-enter space-y-5">
              <div className="skeleton-shimmer h-32 rounded-2xl" />
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="skeleton-shimmer h-24 rounded-2xl" />
                ))}
              </div>
            </div>
          ) : null}

          {data && section === 'overview' && (
            <div key="sec-overview" className="animate-page-enter space-y-6">
              {/* Gojek-Style Hero Wallet/Status Card */}
              <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/60 p-5 text-white shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-400">
                      <Shield className="h-3 w-3" />
                      Kontrol Turnamen Aktif
                    </span>
                    <h2 className="mt-2 font-display text-2xl font-extrabold uppercase tracking-wide">
                      {data.settings?.eventName}
                    </h2>
                    <p className="text-xs text-slate-300">
                      {data.settings?.eventSubtitle} • {data.settings?.eventMeta}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl bg-white/10 px-3.5 py-2 backdrop-blur-sm">
                      <p className="text-xs font-semibold uppercase text-slate-300">
                        Sedang Live
                      </p>
                      <p className="font-display text-2xl font-extrabold text-amber-400">
                        {liveMatches.length}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/10 px-3.5 py-2 backdrop-blur-sm">
                      <p className="text-xs font-semibold uppercase text-slate-300">
                        Kategori
                      </p>
                      <p className="font-display text-2xl font-extrabold">
                        {activeCategories}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/10 px-3.5 py-2 backdrop-blur-sm">
                      <p className="text-xs font-semibold uppercase text-slate-300">
                        Total Tim
                      </p>
                      <p className="font-display text-2xl font-extrabold">
                        {totalTeams}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white/10 px-3.5 py-2 backdrop-blur-sm">
                      <p className="text-xs font-semibold uppercase text-slate-300">
                        Live Report
                      </p>
                      <p className="font-display text-2xl font-extrabold">
                        {totalReports}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Action Grid */}
              <div>
                <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  <LayoutGrid className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                  Menu Cepat Panitia
                </h3>
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
                  {quickActions.map((qa) => {
                    const Icon = qa.icon;
                    return (
                      <button
                        key={qa.title}
                        type="button"
                        onClick={qa.onClick}
                        className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-3.5 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-amber-500/50 hover:shadow-md active:scale-95 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div
                          className={`mb-2 flex h-11 w-11 items-center justify-center rounded-2xl ${qa.colorClass}`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {qa.title}
                        </span>
                        <span className="mt-0.5 line-clamp-1 text-xs text-slate-600 dark:text-slate-400">
                          {qa.subtitle}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active / Upcoming Status Cards */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 font-display text-base font-extrabold uppercase tracking-wider">
                      <BarChart3 className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                      Ringkasan Kategori
                    </h3>
                    <button
                      type="button"
                      onClick={() => setSection('tournaments')}
                      className="inline-flex min-h-9 items-center px-2 text-xs font-bold text-amber-800 hover:underline dark:text-amber-400"
                    >
                      Kelola →
                    </button>
                  </div>
                  <div className="space-y-2">
                    {data.tournaments.map((t) => {
                      const tCount = data.teams.filter(
                        (tm) => tm.tournamentId === t.id
                      ).length;
                      const mCount = data.matches.filter(
                        (m) => m.tournamentId === t.id
                      ).length;
                      return (
                        <div
                          key={t.id}
                          className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-xs dark:bg-slate-950"
                        >
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white">
                              {t.name}
                            </p>
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                              {tCount} Tim • {mCount} Match • Bo{t.bestOf}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                              t.isEnabled
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {t.isEnabled ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 font-display text-base font-extrabold uppercase tracking-wider">
                      <Trophy className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                      Progres Pertandingan
                    </h3>
                    <button
                      type="button"
                      onClick={() => setSection('operator')}
                      className="inline-flex min-h-9 items-center px-2 text-xs font-bold text-amber-800 hover:underline dark:text-amber-400"
                    >
                      Buka Operator →
                    </button>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Sedang Berlangsung (LIVE)
                      </span>
                      <span className="font-display text-lg font-extrabold text-red-600 dark:text-red-400">
                        {liveMatches.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Pertandingan Selesai
                      </span>
                      <span className="font-display text-lg font-extrabold text-amber-700 dark:text-amber-400">
                        {finishedMatches.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Total Foto Live Report
                      </span>
                      <span className="font-display text-lg font-extrabold text-sky-700 dark:text-sky-400">
                        {totalReports}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {data && section === 'operator' && (
            <div key="sec-operator" className="animate-page-enter">
              <LiveOperator data={data} onRefresh={() => loadData(user)} />
            </div>
          )}
          {data &&
            (section === 'tournaments' ||
              section === 'branding' ||
              section === 'users') && (
              <div key={`sec-${section}`} className="animate-page-enter">
                <AdminDashboard
                  data={data}
                  currentUser={user}
                  section={section}
                  onRefresh={() => loadData(user)}
                />
              </div>
            )}
          {data && section === 'media' && (
            <div key="sec-media" className="animate-page-enter">
              <MediaStudio data={data} onRefresh={() => loadData(user)} />
            </div>
          )}
        </main>
      </div>

      {/* MOBILE BOTTOM NAVBAR */}
      <nav
        aria-label="Navigasi Utama Mobile"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 lg:hidden"
      >
        <div className="mx-auto flex max-w-md items-center justify-around">
          {allowedNav.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex min-h-12 min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1 text-xs font-bold transition ${
                  isActive
                    ? 'text-amber-800 dark:text-amber-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <div
                  className={`flex h-7 w-10 items-center justify-center rounded-full transition ${
                    isActive ? 'bg-amber-500/18' : ''
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <span>{item.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

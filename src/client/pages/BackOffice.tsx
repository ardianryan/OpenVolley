import {
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarClock,
  Camera,
  ChevronDown,
  ExternalLink,
  FileText,
  GitBranch,
  Home,
  KeyRound,
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
import {
  getDefaultLandingSection,
  hasAnyPermission,
  type PermissionKey,
} from '../../shared/rbac';
import type { SupportedErrorCode } from '../../shared/routes';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { ErrorPage } from '../components/ErrorPage';
import { ThemeToggle } from '../components/ThemeToggle';
import { VolleyballIcon } from '../components/VolleyballIcon';
import { ApiError, apiFetch } from '../lib/api';
import { syncDocumentBranding } from '../lib/seo';
import type { AuthUser, OverviewData } from '../types';
import { AdminDashboard } from './AdminDashboard';
import { LiveOperator } from './LiveOperator';
import { MasterTeamsManager } from './MasterTeamsManager';
import { MediaStudio } from './MediaStudio';
import { OfficialDocuments } from './OfficialDocuments';
import { ScheduleCourtsManager } from './ScheduleCourtsManager';
import { TvScreensManager } from './TvScreensManager';

type BackOfficeSection =
  | 'overview'
  | 'contingents'
  | 'schedule'
  | 'tv_screens'
  | 'operator'
  | 'tournaments'
  | 'documents'
  | 'branding'
  | 'users'
  | 'media';

const SECTION_TO_PATH: Record<BackOfficeSection, string> = {
  overview: '/back-office/beranda',
  contingents: '/back-office/kontingen',
  schedule: '/back-office/jadwal',
  tv_screens: '/back-office/layar-tv',
  operator: '/back-office/operator',
  tournaments: '/back-office/bagan',
  documents: '/back-office/dokumen',
  media: '/back-office/media',
  branding: '/back-office/branding',
  users: '/back-office/akun',
};

const PATH_TO_SECTION: Record<string, BackOfficeSection> = {
  '/back-office/beranda': 'overview',
  '/back-office/kontingen': 'contingents',
  '/back-office/jadwal': 'schedule',
  '/back-office/layar-tv': 'tv_screens',
  '/back-office/operator': 'operator',
  '/back-office/bagan': 'tournaments',
  '/back-office/dokumen': 'documents',
  '/back-office/media': 'media',
  '/back-office/branding': 'branding',
  '/back-office/akun': 'users',
};

function canUserAccessSection(
  user: AuthUser | null | undefined,
  section: BackOfficeSection
): boolean {
  if (!user) return false;
  return hasAnyPermission(user.permissions, user.role, [section as PermissionKey]);
}

function getInitialSection(user?: AuthUser): BackOfficeSection {
  if (typeof window !== 'undefined') {
    const cleanPath = window.location.pathname.replace(/\/+$/, '');
    const fromPath = PATH_TO_SECTION[cleanPath];
    if (fromPath) {
      return fromPath;
    }
    const saved = localStorage.getItem('ov_bo_section') as BackOfficeSection | null;
    if (saved && saved in SECTION_TO_PATH) {
      if (!user || canUserAccessSection(user, saved)) {
        return saved;
      }
    }
  }
  if (user) {
    return getDefaultLandingSection(
      user.permissions,
      user.role
    ) as BackOfficeSection;
  }
  return 'overview';
}

export function BackOffice() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loadError, setLoadError] = useState<SupportedErrorCode | null>(null);
  const SECTION_TO_GROUP: Partial<Record<BackOfficeSection, string>> = {
    contingents: 'master',
    schedule: 'master',
    tournaments: 'master',
    operator: 'arena',
    tv_screens: 'arena',
    documents: 'media_pub',
    media: 'media_pub',
    branding: 'system',
    users: 'system',
  };

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [section, setSectionState] = useState<BackOfficeSection>(() => getInitialSection());
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial = getInitialSection();
    const grp = SECTION_TO_GROUP[initial];
    return grp ? { [grp]: true } : {};
  });

  useEffect(() => {
    const grp = SECTION_TO_GROUP[section];
    setOpenGroups(grp ? { [grp]: true } : {});
  }, [section]);

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
      const canReadAdminOverview = hasAnyPermission(u.permissions, u.role, [
        'overview',
        'contingents',
        'schedule',
        'tournaments',
        'operator',
        'tv_screens',
        'documents',
        'branding',
      ]);
      const endpoint = canReadAdminOverview
        ? `/api/admin/overview?_=${Date.now()}`
        : `/api/public/overview?_=${Date.now()}`;
      const res = await apiFetch<OverviewData>(endpoint, { cache: 'no-store' });
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
          setSection(getInitialSection(res.user));
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
  }, [loadData, setSection]);

  useEffect(() => {
    syncDocumentBranding(data?.settings, 'Back-Office');
  }, [data?.settings]);

  // Keep Back-Office (Media Studio / Multi-Operator / Admin) live-synced via SSE
  useEffect(() => {
    if (!user) return;
    const es = new EventSource('/api/public/stream');
    for (const ev of [
      'match_updated',
      'bracket_updated',
      'draw_slot_updated',
      'master_teams_updated',
      'courts_updated',
      'tv_screen_updated',
      'report_added',
      'report_deleted',
      'tournament_updated',
      'settings_updated',
    ]) {
      es.addEventListener(ev, () => {
        loadData(user);
      });
    }
    return () => {
      es.close();
    };
  }, [user, loadData]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setUser(res.user);
      setSection(getInitialSection(res.user));
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
  }> = [
    {
      id: 'overview',
      label: 'Beranda',
      shortLabel: 'Beranda',
      icon: Home,
    },
    {
      id: 'contingents',
      label: 'Master Kontingen',
      shortLabel: 'Kontingen',
      icon: Building2,
    },
    {
      id: 'tournaments',
      label: 'Kategori & Bagan',
      shortLabel: 'Bagan',
      icon: GitBranch,
    },
    {
      id: 'schedule',
      label: 'Master Lapangan & Jadwal',
      shortLabel: 'Jadwal',
      icon: CalendarClock,
    },
    {
      id: 'operator',
      label: 'Live Operator',
      shortLabel: 'Skor',
      icon: Radio,
    },
    {
      id: 'tv_screens',
      label: 'Remote Layar TV',
      shortLabel: 'TV',
      icon: Monitor,
    },
    {
      id: 'documents',
      label: 'Dokumen Resmi',
      shortLabel: 'Dokumen',
      icon: FileText,
    },
    {
      id: 'media',
      label: 'Media Studio',
      shortLabel: 'Media',
      icon: Camera,
    },
    {
      id: 'branding',
      label: 'Branding & Logo',
      shortLabel: 'Brand',
      icon: Palette,
    },
    {
      id: 'users',
      label: 'Manajemen Akun',
      shortLabel: 'Akun',
      icon: Users,
    },
  ];

  const allowedNav = navItems.filter((item) => canUserAccessSection(user, item.id));
  const defaultRoleSection: BackOfficeSection = getDefaultLandingSection(
    user.permissions,
    user.role
  ) as BackOfficeSection;

  // Enforce 403 Forbidden page if user navigates directly to a Back-Office URL outside their permissions
  if (!canUserAccessSection(user, section)) {
    return (
      <ErrorPage
        code={403}
        customMessage={`Akun Anda (${(user.roleName || user.role).toUpperCase()}) tidak memiliki izin untuk membuka halaman ini. Silakan kembali ke menu kerja yang diizinkan.`}
        primaryActionLabel="Buka Menu Utama Saya"
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
      visible: canUserAccessSection(user, 'operator'),
    },
    {
      title: 'Master Kontingen',
      subtitle: `${(data?.masterTeams ?? []).length} tim terdaftar`,
      icon: Building2,
      colorClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
      onClick: () => setSection('contingents'),
      visible: canUserAccessSection(user, 'contingents'),
    },
    {
      title: 'Bagan & Undian',
      subtitle: 'TM Draw & Pool',
      icon: GitBranch,
      colorClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      onClick: () => setSection('tournaments'),
      visible: canUserAccessSection(user, 'tournaments'),
    },
    {
      title: 'Master Lapangan',
      subtitle: `${(data?.masterCourts ?? []).length} lapangan • Tarik Jadwal`,
      icon: CalendarClock,
      colorClass: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
      onClick: () => setSection('schedule'),
      visible: canUserAccessSection(user, 'schedule'),
    },
    {
      title: 'Remote Layar TV',
      subtitle: `${(data?.tvScreens ?? []).length} profil layar & Banner`,
      icon: Monitor,
      colorClass: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
      onClick: () => setSection('tv_screens'),
      visible: canUserAccessSection(user, 'tv_screens'),
    },
    {
      title: 'Dokumen Resmi',
      subtitle: 'Buletin & Berita Acara',
      icon: FileText,
      colorClass: 'bg-teal-500/15 text-teal-700 dark:text-teal-400',
      onClick: () => setSection('documents'),
      visible: canUserAccessSection(user, 'documents'),
    },
    {
      title: 'Media Studio',
      subtitle: 'Poster & Video 18s',
      icon: Camera,
      colorClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
      onClick: () => setSection('media'),
      visible: canUserAccessSection(user, 'media'),
    },
    {
      title: 'Branding SVC',
      subtitle: 'Logo & teks acara',
      icon: Palette,
      colorClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
      onClick: () => setSection('branding'),
      visible: canUserAccessSection(user, 'branding'),
    },
    {
      title: 'Kelola Akun',
      subtitle: 'Role & izin menu',
      icon: Users,
      colorClass: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
      onClick: () => setSection('users'),
      visible: canUserAccessSection(user, 'users'),
    },
    {
      title: 'Layar TV Arena',
      subtitle: 'Proyektor skor',
      icon: Monitor,
      colorClass: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
      onClick: () => {
        window.open('/tv', '_blank', 'noopener,noreferrer');
      },
      visible:
        canUserAccessSection(user, 'tv_screens') ||
        canUserAccessSection(user, 'branding'),
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
    user.roleName ||
    (user.role === 'admin'
      ? 'Admin'
      : user.role === 'panitia'
        ? 'Panitia'
        : user.role === 'media'
          ? 'Tim Media'
          : user.role);
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

          {/* Sidebar Navigation (Grouped Accordions) */}
          <nav className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {/* Pinned Home Item */}
            {allowedNav
              .filter((item) => item.id === 'overview')
              .map((item) => {
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

            {(
              [
                {
                  key: 'master',
                  title: 'Master & Bagan',
                  ids: ['contingents', 'schedule', 'tournaments'] as BackOfficeSection[],
                },
                {
                  key: 'arena',
                  title: 'Arena & Layar TV',
                  ids: ['operator', 'tv_screens'] as BackOfficeSection[],
                },
                {
                  key: 'media_pub',
                  title: 'Publikasi & Media',
                  ids: ['documents', 'media'] as BackOfficeSection[],
                },
                {
                  key: 'system',
                  title: 'Sistem & Akses',
                  ids: ['branding', 'users'] as BackOfficeSection[],
                },
              ] as const
            ).map((grp) => {
              const items = grp.ids
                .map((id) => allowedNav.find((n) => n.id === id))
                .filter((x): x is NonNullable<typeof x> => Boolean(x));
              if (items.length === 0) return null;

              const hasActiveChild = items.some((it) => it.id === section);
              const isOpen = Boolean(openGroups[grp.key]);

              return (
                <div
                  key={grp.key}
                  className="rounded-xl border border-slate-100 bg-slate-50/60 p-1.5 dark:border-slate-800/70 dark:bg-slate-950/40"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenGroups((prev) => ({
                        ...prev,
                        [grp.key]: !prev[grp.key],
                      }))
                    }
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px] font-extrabold uppercase tracking-wider text-slate-500 transition-colors duration-200 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    <span className="flex items-center gap-1.5">
                      {grp.title}
                      {hasActiveChild && !isOpen && (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      )}
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform duration-300 ease-out ${
                        isOpen ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                  </button>

                  <div
                    aria-hidden={!isOpen}
                    className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isOpen
                        ? 'grid-rows-[1fr] opacity-100'
                        : 'pointer-events-none grid-rows-[0fr] opacity-0'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="mt-1 space-y-1">
                        {items.map((item) => {
                          const Icon = item.icon;
                          const isActive = section === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              tabIndex={isOpen ? 0 : -1}
                              onClick={() => setSection(item.id)}
                              className={`flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-bold transition ${
                                isActive
                                  ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/20'
                                  : 'text-slate-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800/80'
                              }`}
                            >
                              <Icon className="h-4 w-4 shrink-0" />
                              <span className="truncate">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
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
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setShowChangePassword(true)}
                aria-label="Ubah password akun"
                title="Ubah Password"
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-amber-500/15 hover:text-amber-800 dark:text-slate-400 dark:hover:text-amber-300"
              >
                <KeyRound className="h-4 w-4" />
              </button>
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
              onClick={() => setShowChangePassword(true)}
              aria-label="Ubah password akun"
              title="Ubah Password Saya"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-xs transition hover:border-amber-600 hover:text-amber-800 sm:h-9 sm:w-9 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-amber-300"
            >
              <KeyRound className="h-4 w-4" />
            </button>
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
          {data && section === 'documents' && (
            <div key="sec-documents" className="animate-page-enter">
              <OfficialDocuments
                data={data}
                currentUser={user}
                onRefresh={() => loadData(user)}
              />
            </div>
          )}
          {data && section === 'contingents' && (
            <div key="sec-contingents" className="animate-page-enter">
              <MasterTeamsManager data={data} onRefresh={() => loadData(user)} />
            </div>
          )}
          {data && section === 'schedule' && (
            <div key="sec-schedule" className="animate-page-enter">
              <ScheduleCourtsManager data={data} onRefresh={() => loadData(user)} />
            </div>
          )}
          {data && section === 'tv_screens' && (
            <div key="sec-tv-screens" className="animate-page-enter">
              <TvScreensManager data={data} onRefresh={() => loadData(user)} />
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

      {showChangePassword && (
        <ChangePasswordModal
          user={user}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </div>
  );
}

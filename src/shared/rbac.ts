export const PERMISSION_KEYS = [
  'overview',
  'contingents',
  'schedule',
  'tournaments',
  'operator',
  'tv_screens',
  'obs_overlays',
  'documents',
  'media',
  'branding',
  'integrations',
  'users',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  shortLabel: string;
  description: string;
  group: 'Umum' | 'Master & Bagan' | 'Arena & Layar TV' | 'Publikasi & Media' | 'Sistem';
}

export const PERMISSION_CATALOG: PermissionMeta[] = [
  {
    key: 'overview',
    label: 'Beranda',
    shortLabel: 'Beranda',
    description: 'Ringkasan turnamen, progres pertandingan & pintasan cepat.',
    group: 'Umum',
  },
  {
    key: 'contingents',
    label: 'Master Kontingen',
    shortLabel: 'Kontingen',
    description: 'Kelola database sekolah/kontingen, logo & import Google Sheets.',
    group: 'Master & Bagan',
  },
  {
    key: 'schedule',
    label: 'Master Lapangan & Jadwal',
    shortLabel: 'Jadwal',
    description: 'Kelola daftar lapangan, tarik jadwal & salin pola jam.',
    group: 'Master & Bagan',
  },
  {
    key: 'tournaments',
    label: 'Kategori & Bagan',
    shortLabel: 'Bagan',
    description: 'Buat kategori, TM drawing slot & pembagian pool.',
    group: 'Master & Bagan',
  },
  {
    key: 'operator',
    label: 'Live Operator',
    shortLabel: 'Skor',
    description: 'Input skor rally, timeout, substitusi, servis & selesaikan match.',
    group: 'Arena & Layar TV',
  },
  {
    key: 'tv_screens',
    label: 'Remote Layar TV',
    shortLabel: 'TV',
    description: 'Atur profil layar TV, remote mode tampil & standby banner.',
    group: 'Arena & Layar TV',
  },
  {
    key: 'obs_overlays',
    label: 'OBS Broadcast & Remote',
    shortLabel: 'OBS',
    description: 'Kelola link OBS Browser Source bertoken, variasi overlay & kontrol siaran.',
    group: 'Publikasi & Media',
  },
  {
    key: 'documents',
    label: 'Dokumen Resmi',
    shortLabel: 'Dokumen',
    description: 'Atur metadata & unduh Buletin Turnamen / Berita Acara PDF.',
    group: 'Publikasi & Media',
  },
  {
    key: 'media',
    label: 'Media Studio',
    shortLabel: 'Media',
    description: 'Buat poster/video broadcast & publikasi Galeri Momen.',
    group: 'Publikasi & Media',
  },
  {
    key: 'branding',
    label: 'Branding & Logo',
    shortLabel: 'Brand',
    description: 'Ubah logo acara, sponsor, PIN TV, akses TV publik & SEO.',
    group: 'Sistem',
  },
  {
    key: 'integrations',
    label: 'Webhooks & Backup S3',
    shortLabel: 'Integrasi',
    description: 'Kelola webhook event real-time & snapshot backup SQLite ke S3.',
    group: 'Sistem',
  },
  {
    key: 'users',
    label: 'Manajemen Akun & Role',
    shortLabel: 'Akun',
    description: 'Kelola akun staf, role kustom & centang izin menu.',
    group: 'Sistem',
  },
];

export const DEFAULT_SYSTEM_ROLES: Array<{
  slug: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  isSystem: boolean;
}> = [
  {
    slug: 'admin',
    name: 'Administrator Penuh',
    description: 'Akses penuh seluruh fitur sistem, pengaturan & akun.',
    permissions: [...PERMISSION_KEYS],
    isSystem: true,
  },
  {
    slug: 'panitia',
    name: 'Panitia Pertandingan',
    description: 'Operasional kontingen, lapangan, bagan TM, skor, TV & dokumen.',
    permissions: [
      'overview',
      'contingents',
      'schedule',
      'tournaments',
      'operator',
      'tv_screens',
      'obs_overlays',
      'documents',
    ],
    isSystem: true,
  },
  {
    slug: 'media',
    name: 'Tim Media & Publikasi',
    description: 'Media Studio broadcast grafik, video & galeri momen.',
    permissions: ['media', 'obs_overlays'],
    isSystem: true,
  },
];

const PERMISSION_SET = new Set<string>(PERMISSION_KEYS);

export function sanitizePermissionList(input: unknown): PermissionKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<PermissionKey>();
  for (const raw of input) {
    if (typeof raw === 'string' && PERMISSION_SET.has(raw)) {
      seen.add(raw as PermissionKey);
    }
  }
  return PERMISSION_KEYS.filter((k) => seen.has(k));
}

export function parsePermissionsJson(
  raw: string | null | undefined
): PermissionKey[] | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return sanitizePermissionList(parsed);
  } catch {
    return null;
  }
}

export function resolveEffectivePermissions(
  roleSlug: string,
  userCustomPermissionsJson: string | null | undefined,
  rolePermissionsJson: string | null | undefined
): PermissionKey[] {
  if (roleSlug === 'admin') {
    return [...PERMISSION_KEYS];
  }
  const userCustom = parsePermissionsJson(userCustomPermissionsJson);
  if (userCustom !== null) {
    return userCustom;
  }
  const roleDefault = parsePermissionsJson(rolePermissionsJson);
  if (roleDefault !== null) {
    return roleDefault;
  }
  const builtin = DEFAULT_SYSTEM_ROLES.find((r) => r.slug === roleSlug);
  return builtin ? [...builtin.permissions] : [];
}

export function hasAnyPermission(
  permissions: PermissionKey[] | undefined,
  roleSlug: string | undefined,
  required: PermissionKey[]
): boolean {
  if (roleSlug === 'admin') return true;
  if (!permissions || permissions.length === 0) return false;
  if (required.length === 0) return true;
  return required.some((req) => permissions.includes(req));
}

export function getDefaultLandingSection(
  permissions: PermissionKey[] | undefined,
  roleSlug?: string
): PermissionKey {
  if (roleSlug === 'admin') return 'overview';
  if (!permissions || permissions.length === 0) return 'overview';
  if (permissions.includes('overview')) return 'overview';
  return permissions[0] ?? 'overview';
}

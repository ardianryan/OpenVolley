import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { sign } from 'hono/jwt';
import { asc, eq } from 'drizzle-orm';
import {
  parsePermissionsJson,
  resolveEffectivePermissions,
  sanitizePermissionList,
} from '../../shared/rbac';
import { sanitizePlainText } from '../../shared/sanitize';
import { db } from '../db';
import { roles, users } from '../db/schema';
import {
  AUTH_COOKIE_NAME,
  type AuthUser,
  JWT_SECRET,
  requireAuth,
  resolveLiveAuthUser,
} from '../middleware/auth';
import { createRateLimiter, isSecureRequest } from '../middleware/security';

export const authRoutes = new Hono<{ Variables: { user: AuthUser } }>();

export const loginRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxAttempts: 8,
  namespace: 'auth_login',
});

export const passwordChangeLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxAttempts: 8,
  namespace: 'auth_pwd_change',
});

function slugifyRoleName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

authRoutes.post('/login', async (c) => {
  const limit = loginRateLimiter.check(c);
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return c.json(
      { error: `Terlalu banyak percobaan login. Coba lagi dalam ${limit.retryAfterSec} detik.` },
      429
    );
  }

  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({
    username: '',
    password: '',
  }));
  const username = body.username?.trim();
  const password = body.password;

  if (!username || !password) {
    return c.json({ error: 'Username dan password wajib diisi' }, 400);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user || !(await Bun.password.verify(password, user.passwordHash))) {
    loginRateLimiter.recordFailure(c);
    return c.json({ error: 'Username atau password salah' }, 401);
  }

  loginRateLimiter.reset(c);

  const liveUser = await resolveLiveAuthUser(user.id);
  if (!liveUser) {
    return c.json({ error: 'Akun tidak valid' }, 401);
  }

  const payload = {
    id: liveUser.id,
    username: liveUser.username,
    name: liveUser.name,
    role: liveUser.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
  };

  const token = await sign(payload, JWT_SECRET, 'HS256');
  setCookie(c, AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({ user: liveUser });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth(), (c) => {
  return c.json({ user: c.get('user') });
});

// Self-service password change for any authenticated user
authRoutes.post('/change-password', requireAuth(), async (c) => {
  const limit = passwordChangeLimiter.check(c);
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return c.json(
      { error: `Terlalu banyak percobaan. Coba lagi dalam ${limit.retryAfterSec} detik.` },
      429
    );
  }

  const body = await c
    .req.json<{ currentPassword?: string; newPassword?: string }>()
    .catch(() => ({ currentPassword: '', newPassword: '' }));

  const currentPassword = body.currentPassword ?? '';
  const newPassword = body.newPassword ?? '';

  if (!currentPassword || !newPassword) {
    return c.json({ error: 'Password saat ini dan password baru wajib diisi' }, 400);
  }

  if (newPassword.length < 6 || newPassword.length > 128) {
    return c.json({ error: 'Password baru minimal 6 karakter (maksimal 128 karakter)' }, 400);
  }

  const authUser = c.get('user');
  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
  });

  if (!dbUser || !(await Bun.password.verify(currentPassword, dbUser.passwordHash))) {
    passwordChangeLimiter.recordFailure(c);
    return c.json({ error: 'Password saat ini tidak sesuai' }, 401);
  }

  passwordChangeLimiter.reset(c);

  const nextHash = await Bun.password.hash(newPassword);
  await db
    .update(users)
    .set({ passwordHash: nextHash })
    .where(eq(users.id, dbUser.id));

  return c.json({ ok: true });
});

// =========================================================================
// ADMIN ROLE MANAGEMENT (System Roles + Custom Roles with Menu Checkboxes)
// =========================================================================
authRoutes.get('/roles', requireAuth(['admin']), async (c) => {
  const allRoles = await db.select().from(roles).orderBy(asc(roles.id));
  const allUsers = await db.select({ role: users.role }).from(users);
  const countByRole = new Map<string, number>();
  for (const u of allUsers) {
    countByRole.set(u.role, (countByRole.get(u.role) ?? 0) + 1);
  }

  return c.json({
    roles: allRoles.map((r) => ({
      ...r,
      permissions: resolveEffectivePermissions(r.slug, null, r.permissionsJson),
      userCount: countByRole.get(r.slug) ?? 0,
    })),
  });
});

authRoutes.post('/roles', requireAuth(['admin']), async (c) => {
  const body = await c.req.json<{
    name?: string;
    slug?: string;
    description?: string;
    permissions?: unknown;
  }>();

  const name = sanitizePlainText(body.name, 60);
  if (!name) {
    return c.json({ error: 'Nama role wajib diisi' }, 400);
  }

  const slug = slugifyRoleName(body.slug || name);
  if (!slug || slug.length < 2) {
    return c.json({ error: 'Slug / kode role tidak valid (minimal 2 huruf/angka)' }, 400);
  }

  const existing = await db.query.roles.findFirst({
    where: eq(roles.slug, slug),
  });
  if (existing) {
    return c.json({ error: `Role dengan kode "${slug}" sudah ada` }, 409);
  }

  const cleanPerms = sanitizePermissionList(body.permissions);
  if (cleanPerms.length === 0) {
    return c.json({ error: 'Centang minimal 1 menu izin akses untuk role ini' }, 400);
  }

  const [created] = await db
    .insert(roles)
    .values({
      slug,
      name,
      description: sanitizePlainText(body.description, 160),
      permissionsJson: JSON.stringify(cleanPerms),
      isSystem: false,
      createdAt: Date.now(),
    })
    .returning();

  return c.json(
    {
      role: {
        ...created,
        permissions: cleanPerms,
        userCount: 0,
      },
    },
    201
  );
});

authRoutes.put('/roles/:id', requireAuth(['admin']), async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await db.query.roles.findFirst({
    where: eq(roles.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Role tidak ditemukan' }, 404);
  }

  if (existing.slug === 'admin') {
    return c.json({ error: 'Izin role Administrator Penuh tidak boleh dikurangi' }, 400);
  }

  const body = await c.req.json<{
    name?: string;
    description?: string;
    permissions?: unknown;
  }>();

  const patch: Partial<typeof roles.$inferInsert> = {};
  if (body.name !== undefined && !existing.isSystem) {
    const cleanName = sanitizePlainText(body.name, 60);
    if (cleanName) patch.name = cleanName;
  }
  if (body.description !== undefined) {
    patch.description = sanitizePlainText(body.description, 160);
  }
  if (body.permissions !== undefined) {
    const cleanPerms = sanitizePermissionList(body.permissions);
    if (cleanPerms.length === 0) {
      return c.json({ error: 'Centang minimal 1 menu izin akses untuk role ini' }, 400);
    }
    patch.permissionsJson = JSON.stringify(cleanPerms);
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'Tidak ada perubahan yang dikirim' }, 400);
  }

  const [updated] = await db
    .update(roles)
    .set(patch)
    .where(eq(roles.id, id))
    .returning();

  return c.json({
    role: {
      ...updated,
      permissions: resolveEffectivePermissions(
        updated!.slug,
        null,
        updated!.permissionsJson
      ),
    },
  });
});

authRoutes.delete('/roles/:id', requireAuth(['admin']), async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await db.query.roles.findFirst({
    where: eq(roles.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Role tidak ditemukan' }, 404);
  }
  if (existing.isSystem) {
    return c.json({ error: 'Role bawaan sistem tidak dapat dihapus' }, 400);
  }

  const assignedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, existing.slug));
  if (assignedUsers.length > 0) {
    return c.json(
      {
        error: `Role "${existing.name}" masih digunakan oleh ${assignedUsers.length} akun. Pindahkan akun tersebut terlebih dahulu.`,
      },
      409
    );
  }

  await db.delete(roles).where(eq(roles.id, id));
  return c.json({ ok: true });
});

// =========================================================================
// ADMIN USER MANAGEMENT (With Per-User Menu Permission Overrides)
// =========================================================================
async function formatUserForAdmin(u: {
  id: number;
  username: string;
  name: string;
  role: string;
  permissionsJson: string | null;
  createdAt: number;
}) {
  const dbRole = await db.query.roles.findFirst({
    where: eq(roles.slug, u.role),
  });
  const customPermissions = parsePermissionsJson(u.permissionsJson);
  const permissions = resolveEffectivePermissions(
    u.role,
    u.permissionsJson,
    dbRole?.permissionsJson
  );
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    roleName: dbRole?.name || u.role,
    customPermissions,
    permissions,
    hasCustomPermissions: customPermissions !== null,
    createdAt: u.createdAt,
  };
}

authRoutes.get('/users', requireAuth(['admin']), async (c) => {
  const list = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      permissionsJson: users.permissionsJson,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.id));

  const roleRows = await db.select().from(roles);
  const roleBySlug = new Map(roleRows.map((r) => [r.slug, r]));

  return c.json({
    users: list.map((u) => {
      const dbRole = roleBySlug.get(u.role);
      const customPermissions = parsePermissionsJson(u.permissionsJson);
      return {
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        roleName: dbRole?.name || u.role,
        customPermissions,
        permissions: resolveEffectivePermissions(
          u.role,
          u.permissionsJson,
          dbRole?.permissionsJson
        ),
        hasCustomPermissions: customPermissions !== null,
        createdAt: u.createdAt,
      };
    }),
  });
});

authRoutes.post('/users', requireAuth(['admin']), async (c) => {
  const body = await c.req.json<{
    username?: string;
    name?: string;
    password?: string;
    role?: string;
    permissions?: string[] | null;
  }>();

  const cleanUsername = sanitizePlainText(body.username, 50).replace(/\s+/g, '');
  const cleanName = sanitizePlainText(body.name, 100);
  if (!cleanUsername || !cleanName || !body.password) {
    return c.json({ error: 'Username, nama, dan password wajib diisi' }, 400);
  }

  if (body.password.length < 6 || body.password.length > 128) {
    return c.json({ error: 'Password minimal 6 karakter (maksimal 128 karakter)' }, 400);
  }

  const targetRoleSlug = (body.role || 'panitia').trim().toLowerCase();
  const roleRow = await db.query.roles.findFirst({
    where: eq(roles.slug, targetRoleSlug),
  });
  if (!roleRow) {
    return c.json({ error: 'Role pengguna tidak valid atau belum terdaftar' }, 400);
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.username, cleanUsername),
  });
  if (existing) {
    return c.json({ error: 'Username sudah terdaftar' }, 409);
  }

  let permissionsJson: string | null = null;
  if (targetRoleSlug !== 'admin' && Array.isArray(body.permissions)) {
    const cleanPerms = sanitizePermissionList(body.permissions);
    permissionsJson = JSON.stringify(cleanPerms);
  }

  const passwordHash = await Bun.password.hash(body.password);
  const [created] = await db
    .insert(users)
    .values({
      username: cleanUsername,
      name: cleanName,
      passwordHash,
      role: targetRoleSlug,
      permissionsJson,
      createdAt: Date.now(),
    })
    .returning({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      permissionsJson: users.permissionsJson,
      createdAt: users.createdAt,
    });

  return c.json({ user: await formatUserForAdmin(created!) }, 201);
});

authRoutes.put('/users/:id', requireAuth(['admin']), async (c) => {
  const id = Number(c.req.param('id'));
  const currentUser = c.get('user');

  const existing = await db.query.users.findFirst({
    where: eq(users.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Akun tidak ditemukan' }, 404);
  }

  const body = await c
    .req.json<{
      name?: string;
      role?: string;
      password?: string;
      permissions?: string[] | null;
    }>()
    .catch(
      () =>
        ({} as {
          name?: string;
          role?: string;
          password?: string;
          permissions?: string[] | null;
        })
    );

  const updates: Partial<typeof users.$inferInsert> = {};

  if (body.name !== undefined) {
    const cleanName = sanitizePlainText(body.name, 100);
    if (!cleanName) {
      return c.json({ error: 'Nama lengkap tidak boleh kosong' }, 400);
    }
    updates.name = cleanName;
  }

  const nextRoleSlug =
    body.role !== undefined ? body.role.trim().toLowerCase() : existing.role;

  if (body.role !== undefined) {
    const roleRow = await db.query.roles.findFirst({
      where: eq(roles.slug, nextRoleSlug),
    });
    if (!roleRow) {
      return c.json({ error: 'Role pengguna tidak valid atau belum terdaftar' }, 400);
    }
    if (id === currentUser.id && nextRoleSlug !== 'admin') {
      return c.json({ error: 'Tidak dapat menurunkan role akun admin yang sedang dipakai' }, 400);
    }
    updates.role = nextRoleSlug;
  }

  if (body.permissions !== undefined) {
    if (nextRoleSlug === 'admin' || body.permissions === null) {
      updates.permissionsJson = null;
    } else if (Array.isArray(body.permissions)) {
      updates.permissionsJson = JSON.stringify(sanitizePermissionList(body.permissions));
    }
  } else if (body.role !== undefined && nextRoleSlug === 'admin') {
    updates.permissionsJson = null;
  }

  if (body.password !== undefined && body.password !== '') {
    if (body.password.length < 6 || body.password.length > 128) {
      return c.json({ error: 'Password baru minimal 6 karakter (maksimal 128 karakter)' }, 400);
    }
    updates.passwordHash = await Bun.password.hash(body.password);
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'Tidak ada perubahan yang dikirim' }, 400);
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      permissionsJson: users.permissionsJson,
      createdAt: users.createdAt,
    });

  // Refresh active session cookie if admin updated their own display name
  if (id === currentUser.id && updated) {
    const token = await sign(
      {
        id: updated.id,
        username: updated.username,
        name: updated.name,
        role: updated.role,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
      },
      JWT_SECRET,
      'HS256'
    );
    setCookie(c, AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isSecureRequest(c),
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return c.json({ user: await formatUserForAdmin(updated!) });
});

authRoutes.delete('/users/:id', requireAuth(['admin']), async (c) => {
  const id = Number(c.req.param('id'));
  const currentUser = c.get('user');
  if (id === currentUser.id) {
    return c.json({ error: 'Tidak dapat menghapus akun yang sedang dipakai' }, 400);
  }
  await db.delete(users).where(eq(users.id, id));
  return c.json({ ok: true });
});

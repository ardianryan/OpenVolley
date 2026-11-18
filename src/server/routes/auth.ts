import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { sign } from 'hono/jwt';
import { asc, eq } from 'drizzle-orm';
import { sanitizePlainText } from '../../shared/sanitize';
import { db } from '../db';
import { users } from '../db/schema';
import {
  AUTH_COOKIE_NAME,
  type AuthUser,
  JWT_SECRET,
  requireAuth,
} from '../middleware/auth';
import { createRateLimiter, isSecureRequest } from '../middleware/security';

export const authRoutes = new Hono<{ Variables: { user: AuthUser } }>();
const VALID_ROLES = ['admin', 'panitia', 'media'] as const;

export const loginRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxAttempts: 8,
  namespace: 'auth_login',
});

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

  const payload = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
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

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    },
  });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth(), (c) => {
  return c.json({ user: c.get('user') });
});

// Admin-only user management
authRoutes.get('/users', requireAuth(['admin']), async (c) => {
  const list = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.id));
  return c.json({ users: list });
});

authRoutes.post('/users', requireAuth(['admin']), async (c) => {
  const body = await c.req.json<{
    username?: string;
    name?: string;
    password?: string;
    role?: 'admin' | 'panitia' | 'media';
  }>();

  const cleanUsername = sanitizePlainText(body.username, 50).replace(/\s+/g, '');
  const cleanName = sanitizePlainText(body.name, 100);
  if (!cleanUsername || !cleanName || !body.password) {
    return c.json({ error: 'Username, nama, dan password wajib diisi' }, 400);
  }

  const role = body.role ?? 'panitia';
  if (!VALID_ROLES.includes(role)) {
    return c.json({ error: 'Role pengguna tidak valid' }, 400);
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.username, cleanUsername),
  });
  if (existing) {
    return c.json({ error: 'Username sudah terdaftar' }, 409);
  }

  const passwordHash = await Bun.password.hash(body.password);
  const [created] = await db
    .insert(users)
    .values({
      username: cleanUsername,
      name: cleanName,
      passwordHash,
      role,
      createdAt: Date.now(),
    })
    .returning({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    });

  return c.json({ user: created }, 201);
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

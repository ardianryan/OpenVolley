import { eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  hasAnyPermission,
  parsePermissionsJson,
  type PermissionKey,
  resolveEffectivePermissions,
} from '../../shared/rbac';
import { db } from '../db';
import { roles, users } from '../db/schema';

function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'test') return 'test-secret-key';

  const secretFile = './data/.jwt_secret';
  if (existsSync(secretFile)) {
    return readFileSync(secretFile, 'utf8').trim();
  }
  mkdirSync('./data', { recursive: true });
  const generated = randomBytes(32).toString('hex');
  writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const JWT_SECRET = resolveJwtSecret();
export const AUTH_COOKIE_NAME = 'ov_token';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: string;
  permissions: PermissionKey[];
  hasCustomPermissions?: boolean;
}

export async function resolveLiveAuthUser(userId: number): Promise<AuthUser | null> {
  if (!Number.isFinite(userId)) return null;
  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!dbUser) return null;

  const dbRole = await db.query.roles.findFirst({
    where: eq(roles.slug, dbUser.role),
  });

  const permissions = resolveEffectivePermissions(
    dbUser.role,
    dbUser.permissionsJson,
    dbRole?.permissionsJson
  );

  return {
    id: dbUser.id,
    username: dbUser.username,
    name: dbUser.name,
    role: dbUser.role,
    permissions,
    hasCustomPermissions: parsePermissionsJson(dbUser.permissionsJson) !== null,
  };
}

export async function authenticateRequestUser(c: Context): Promise<AuthUser | null> {
  const existing = c.get('user') as AuthUser | undefined;
  if (existing && typeof existing.id === 'number' && Array.isArray(existing.permissions)) {
    return existing;
  }

  const token = getCookie(c, AUTH_COOKIE_NAME);
  if (!token) return null;

  try {
    const payload = (await verify(token, JWT_SECRET, 'HS256')) as { id?: number };
    if (typeof payload.id !== 'number') return null;
    const liveUser = await resolveLiveAuthUser(payload.id);
    if (!liveUser) return null;
    c.set('user', liveUser);
    return liveUser;
  } catch {
    return null;
  }
}

export function requireAuth(allowedRoles?: string[]) {
  return async (c: Context, next: Next) => {
    const token = getCookie(c, AUTH_COOKIE_NAME);
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const liveUser = await authenticateRequestUser(c);
    if (!liveUser) {
      return c.json({ error: 'Sesi tidak valid atau akun sudah dihapus' }, 401);
    }

    if (allowedRoles && !allowedRoles.includes(liveUser.role)) {
      return c.json({ error: 'Forbidden: akses ditolak untuk role Anda' }, 403);
    }

    await next();
  };
}

export function requirePermission(...required: PermissionKey[]) {
  return async (c: Context, next: Next) => {
    const token = getCookie(c, AUTH_COOKIE_NAME);
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const liveUser = await authenticateRequestUser(c);
    if (!liveUser) {
      return c.json({ error: 'Sesi tidak valid atau akun sudah dihapus' }, 401);
    }

    if (!hasAnyPermission(liveUser.permissions, liveUser.role, required)) {
      return c.json(
        { error: 'Forbidden: akun Anda tidak memiliki izin akses untuk menu/aksi ini' },
        403
      );
    }

    await next();
  };
}

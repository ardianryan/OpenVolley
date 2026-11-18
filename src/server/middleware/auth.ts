import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

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
  role: 'admin' | 'panitia' | 'media';
}

export function requireAuth(allowedRoles?: Array<AuthUser['role']>) {
  return async (c: Context, next: Next) => {
    const token = getCookie(c, AUTH_COOKIE_NAME);
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const payload = (await verify(token, JWT_SECRET, 'HS256')) as unknown as AuthUser;
      if (allowedRoles && !allowedRoles.includes(payload.role)) {
        return c.json({ error: 'Forbidden: akses ditolak untuk role Anda' }, 403);
      }
      c.set('user', payload);
      await next();
    } catch {
      return c.json({ error: 'Sesi tidak valid atau sudah berakhir' }, 401);
    }
  };
}

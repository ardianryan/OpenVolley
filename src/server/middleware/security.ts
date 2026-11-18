import type { Context, Next } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getClientIp } from '../services/sse';

export const APP_CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://challenges.cloudflare.com blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "connect-src 'self' blob: data: https: http:",
  "frame-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

/**
 * Standard HTTP security & anti-XSS headers applied to every response.
 */
export function securityHeaders() {
  return async (c: Context, next: Next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'SAMEORIGIN');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-XSS-Protection', '0');
    c.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    c.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()'
    );
    if (!c.res.headers.get('Content-Security-Policy')) {
      c.header('Content-Security-Policy', APP_CSP_POLICY);
    }
  };
}

/**
 * Detects whether the request arrived over HTTPS (direct or behind a reverse proxy / Cloudflare).
 */
export function isSecureRequest(c: Context): boolean {
  try {
    if (new URL(c.req.url).protocol === 'https:') return true;
  } catch {
    // Ignore malformed URL fallback
  }
  const proto = c.req.header('x-forwarded-proto');
  if (proto && proto.split(',')[0]?.trim().toLowerCase() === 'https') {
    return true;
  }
  return false;
}

/**
 * Constant-time PIN / secret string comparison (hashes both sides to 32 bytes so length never leaks).
 */
export function safeComparePin(input: string, expected: string): boolean {
  const digestA = createHash('sha256').update(input).digest();
  const digestB = createHash('sha256').update(expected).digest();
  return timingSafeEqual(digestA, digestB);
}

interface RateLimitEntry {
  timestamps: number[];
}

export interface SlidingRateLimiter {
  check: (c: Context) => { allowed: boolean; retryAfterSec: number };
  recordFailure: (c: Context) => void;
  reset: (c: Context) => void;
  clearAll: () => void;
}

/**
 * Lightweight in-memory per-IP sliding-window rate limiter for auth & PIN endpoints.
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxAttempts: number;
  namespace?: string;
}): SlidingRateLimiter {
  const store = new Map<string, RateLimitEntry>();
  const { windowMs, maxAttempts, namespace = 'default' } = options;

  const keyFor = (c: Context) => `${namespace}:${getClientIp(c)}`;

  const prune = (now: number, entry: RateLimitEntry) => {
    const cutoff = now - windowMs;
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
  };

  return {
    check(c: Context) {
      const now = Date.now();
      const key = keyFor(c);
      const entry = store.get(key);
      if (!entry) return { allowed: true, retryAfterSec: 0 };

      prune(now, entry);
      if (entry.timestamps.length === 0) {
        store.delete(key);
        return { allowed: true, retryAfterSec: 0 };
      }

      if (entry.timestamps.length >= maxAttempts) {
        const oldest = entry.timestamps[0] ?? now;
        const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
        return { allowed: false, retryAfterSec };
      }

      return { allowed: true, retryAfterSec: 0 };
    },

    recordFailure(c: Context) {
      const now = Date.now();
      const key = keyFor(c);
      const entry = store.get(key) ?? { timestamps: [] };
      prune(now, entry);
      entry.timestamps.push(now);
      store.set(key, entry);

      // Keep memory bounded under sustained random-IP sweeps
      if (store.size > 5000) {
        for (const [k, v] of store) {
          prune(now, v);
          if (v.timestamps.length === 0) store.delete(k);
        }
      }
    },

    reset(c: Context) {
      store.delete(keyFor(c));
    },

    clearAll() {
      store.clear();
    },
  };
}

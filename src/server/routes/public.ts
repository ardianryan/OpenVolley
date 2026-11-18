import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { streamSSE } from 'hono/streaming';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { matchReports } from '../db/schema';
import { AUTH_COOKIE_NAME, JWT_SECRET } from '../middleware/auth';
import {
  createRateLimiter,
  isSecureRequest,
  safeComparePin,
} from '../middleware/security';
import { getFullOverview } from '../services/overview';
import { getMatchWithSets } from '../services/scoring';
import {
  MAX_SSE_CLIENTS,
  addSseClient,
  canAcceptSseClient,
  getClientIp,
  getOverviewVersion,
  getSseClientCount,
  removeSseClient,
} from '../services/sse';

export const publicRoutes = new Hono();
const TV_VIP_COOKIE = 'ov_tv_vip';

async function isTvVipAuthorized(c: Context): Promise<boolean> {
  // 1. Check active Admin/Panitia session cookie
  const authToken = getCookie(c, AUTH_COOKIE_NAME);
  if (authToken) {
    try {
      const payload = (await verify(authToken, JWT_SECRET, 'HS256')) as { role?: string };
      if (payload.role === 'admin' || payload.role === 'panitia') {
        return true;
      }
    } catch {
      // Fall through to TV VIP cookie check
    }
  }

  // 2. Check signed TV PIN cookie (also verify pinVersion matches current tvPin)
  const tvCookie = getCookie(c, TV_VIP_COOKIE);
  if (!tvCookie) return false;

  try {
    const payload = (await verify(tvCookie, JWT_SECRET, 'HS256')) as {
      scope?: string;
      pin?: string;
    };
    if (payload.scope !== 'tv_vip') return false;
    const settings = await db.query.siteSettings.findFirst();
    return Boolean(settings && payload.pin === settings.tvPin);
  } catch {
    return false;
  }
}

publicRoutes.get('/health', (c) => {
  return c.json({
    ok: true,
    clientIp: getClientIp(c),
    sseClients: getSseClientCount(),
    maxSseClients: MAX_SSE_CLIENTS,
    overviewVersion: getOverviewVersion(),
  });
});

publicRoutes.get('/overview', async (c) => {
  const etag = `"v${getOverviewVersion()}"`;
  c.header('ETag', etag);
  c.header('Cache-Control', 'public, max-age=2, stale-while-revalidate=5');

  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304);
  }

  const data = await getFullOverview(false);
  return c.json(data);
});

publicRoutes.get('/matches/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const match = await getMatchWithSets(id);
  if (!match) {
    return c.json({ error: 'Pertandingan tidak ditemukan' }, 404);
  }
  const reports = await db
    .select()
    .from(matchReports)
    .where(eq(matchReports.matchId, id))
    .orderBy(desc(matchReports.createdAt));

  return c.json({ match, reports });
});

// TV Display PIN Verification & Priority VIP SSE
publicRoutes.get('/tv-check', async (c) => {
  const authorized = await isTvVipAuthorized(c);
  return c.json({ unlocked: authorized });
});

export const tvPinRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxAttempts: 8,
  namespace: 'tv_pin',
});

publicRoutes.post('/tv-auth', async (c) => {
  const limit = tvPinRateLimiter.check(c);
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return c.json(
      { error: `Terlalu banyak percobaan PIN. Coba lagi dalam ${limit.retryAfterSec} detik.` },
      429
    );
  }

  const body = await c.req.json<{ pin?: string }>().catch(() => ({ pin: '' }));
  const settings = await db.query.siteSettings.findFirst();
  const expectedPin = settings?.tvPin || '4426';
  const candidatePin = typeof body.pin === 'string' ? body.pin.trim() : '';

  if (!candidatePin || !safeComparePin(candidatePin, expectedPin)) {
    tvPinRateLimiter.recordFailure(c);
    return c.json({ error: 'PIN Layar TV tidak sesuai' }, 401);
  }

  tvPinRateLimiter.reset(c);

  const token = await sign(
    {
      scope: 'tv_vip',
      pin: expectedPin,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    },
    JWT_SECRET,
    'HS256'
  );

  setCookie(c, TV_VIP_COOKIE, token, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({ ok: true });
});

// Priority VIP SSE Stream for Court TVs (bypasses public MAX_SSE_CLIENTS cap!)
publicRoutes.get('/tv-stream', async (c) => {
  if (!(await isTvVipAuthorized(c))) {
    return c.json({ error: 'PIN TV diperlukan untuk jalur prioritas SSE' }, 401);
  }

  return streamSSE(c, async (stream) => {
    addSseClient(stream);
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ priority: 'vip', time: Date.now() }),
    });

    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => {});
    }, 20000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      removeSseClient(stream);
    });

    while (true) {
      await stream.sleep(30000);
    }
  });
});

// Standard Public SSE Stream (subject to MAX_SSE_CLIENTS cap -> async fallback)
publicRoutes.get('/stream', (c) => {
  if (!canAcceptSseClient()) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'fallback',
        data: JSON.stringify({ mode: 'polling', intervalMs: 5000 }),
      });
    });
  }

  return streamSSE(c, async (stream) => {
    addSseClient(stream);
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ time: Date.now() }),
    });

    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => {});
    }, 25000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      removeSseClient(stream);
    });

    while (true) {
      await stream.sleep(30000);
    }
  });
});

import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { streamSSE } from 'hono/streaming';
import { desc, eq } from 'drizzle-orm';
import { AUDIO_TRACKS } from '../../shared/audio-library';
import { db } from '../db';
import { matchReports } from '../db/schema';
import { AUTH_COOKIE_NAME, JWT_SECRET } from '../middleware/auth';
import {
  createRateLimiter,
  isSecureRequest,
  safeComparePin,
} from '../middleware/security';
import { getFullOverview } from '../services/overview';
import { generateDynamicOgImagePng } from '../services/ogImage';
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

publicRoutes.get('/og-image.png', async (c) => {
  try {
    const { bytes, etag } = await generateDynamicOgImagePng();
    if (c.req.header('if-none-match') === etag) {
      return c.body(null, 304);
    }
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=180, stale-while-revalidate=300',
        ETag: etag,
      },
    });
  } catch (err) {
    console.error('Failed to generate OG image:', err);
    return c.json({ error: 'Gagal menghasilkan gambar pratinjau sosial' }, 500);
  }
});

const KNOWN_AUDIO_URLS = new Set(AUDIO_TRACKS.map((t) => t.url));

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
    return true;
  }
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (/^(fc|fd|fe80):/i.test(h)) return true;
  return false;
}

async function isAllowedProxyAssetUrl(targetUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false;
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return false;
  }

  if (KNOWN_AUDIO_URLS.has(targetUrl)) {
    return true;
  }

  const s3Public = process.env.S3_PUBLIC_URL?.replace(/\/+$/, '');
  const s3Endpoint = process.env.S3_ENDPOINT?.replace(/\/+$/, '');
  const s3Bucket = process.env.S3_BUCKET?.replace(/^\/+|\/+$/g, '');

  if (s3Public && targetUrl.startsWith(`${s3Public}/`)) {
    return true;
  }
  if (s3Endpoint && s3Bucket && targetUrl.startsWith(`${s3Endpoint}/${s3Bucket}/`)) {
    return true;
  }
  if (s3Endpoint && s3Bucket) {
    try {
      const epHost = new URL(s3Endpoint).host;
      if (parsed.host === `${s3Bucket}.${epHost}`) {
        return true;
      }
    } catch {
      // ignore invalid S3_ENDPOINT
    }
  }

  // Also allow any exact asset URL persisted in active tournament overview (logos, sponsors, covers, reports)
  const overview = await getFullOverview(true);
  const s = overview.settings;
  if (
    s?.logoUrl === targetUrl ||
    s?.coBrandLogoUrl === targetUrl ||
    s?.organizerLogoUrl === targetUrl ||
    s?.socialImageUrl === targetUrl
  ) {
    return true;
  }
  if (s?.sponsorsJson && s.sponsorsJson.includes(targetUrl)) {
    return true;
  }
  if (s?.docSettingsJson && s.docSettingsJson.includes(targetUrl)) {
    return true;
  }
  if (overview.teams.some((t) => t.logoUrl === targetUrl)) {
    return true;
  }
  if (
    overview.reports.some(
      (r) => r.imagePath === targetUrl || (r.mediaJson && r.mediaJson.includes(targetUrl))
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Same-origin CORS-clean proxy for S3 / external tournament assets (logos, sponsors, BGM audio)
 * so HTMLCanvasElement.captureStream() / toBlob() and WebAudio never fail due to missing S3 CORS headers.
 */
publicRoutes.get('/asset-proxy', async (c) => {
  const rawUrl = c.req.query('url')?.trim() || '';
  if (!rawUrl || !(await isAllowedProxyAssetUrl(rawUrl))) {
    return c.json({ error: 'URL aset tidak diizinkan oleh kebijakan keamanan' }, 403);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const upstream = await fetch(rawUrl, { signal: controller.signal });
    if (!upstream.ok) {
      return c.json({ error: 'Aset sumber tidak ditemukan' }, 404);
    }

    const contentType =
      upstream.headers.get('content-type') || 'application/octet-stream';
    // Only allow safe media MIME families (image/*, audio/*, video/*)
    if (!/^(image|audio|video)\//i.test(contentType)) {
      return c.json({ error: 'Tipe konten aset tidak didukung' }, 415);
    }

    const bytes = await upstream.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return c.json({ error: 'Gagal memuat aset dari penyimpanan objek' }, 502);
  } finally {
    clearTimeout(timer);
  }
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

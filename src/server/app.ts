import { Hono, type Context } from 'hono';
import { serveStatic } from 'hono/bun';
import { isKnownSpaPath, parseExplicitErrorRoute } from '../shared/routes';
import { isSecureRequest, securityHeaders } from './middleware/security';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { mediaRoutes } from './routes/media';
import { publicRoutes } from './routes/public';
import { injectDynamicHtmlMeta } from './services/ogImage';

function resolveRequestOrigin(c: Context): string {
  const proto = isSecureRequest(c) ? 'https' : 'http';
  const fwdHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim();
  const host = fwdHost || c.req.header('host')?.trim();
  if (host) {
    return `${proto}://${host}`;
  }
  try {
    return new URL(c.req.url).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

export function createApp() {
  const app = new Hono();

  app.use('*', securityHeaders());

  // Optional scheduled maintenance shield (503 Service Unavailable on public portal, keeps Admin open)
  app.use('/api/public/*', async (c, next) => {
    if (
      process.env.MAINTENANCE_MODE === 'true' &&
      c.req.path !== '/api/public/health'
    ) {
      c.header('Retry-After', '60');
      return c.json(
        {
          error:
            'Sistem portal sedang dalam pemeliharaan singkat. Silakan muat ulang beberapa saat lagi.',
          code: 503,
        },
        503
      );
    }
    await next();
  });

  app.onError((err, c) => {
    console.error('Unhandled server error:', err);
    return c.json({ error: 'Terjadi kesalahan internal pada server', code: 500 }, 500);
  });

  app.route('/api/auth', authRoutes);
  app.route('/api/public', publicRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/media', mediaRoutes);

  // Unknown /api/* endpoint -> clean JSON 404
  app.all('/api/*', (c) => {
    return c.json({ error: 'Endpoint API tidak ditemukan', code: 404 }, 404);
  });

  // Harden user-uploaded media fallback path against content sniffing / inline scripts
  // Note: Do NOT add `sandbox` without `allow-same-origin` here, otherwise drawing `/uploads/*`
  // onto <canvas> marks the canvas as non-origin-clean (`captureStream` / `toBlob` SecurityError).
  app.use('/uploads/*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Cross-Origin-Resource-Policy', 'cross-origin');
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
    );
  });
  app.use('/uploads/*', serveStatic({ root: './data' }));
  app.use('/brand/*', serveStatic({ root: './public' }));
  app.use('/fonts/*', serveStatic({ root: './public' }));

  // PWA Manifest, Theme Init Script, & Service Worker (served in dev, test, and prod)
  app.get('/theme-init.js', async (c) => {
    const file = Bun.file('./public/theme-init.js');
    if (!(await file.exists())) return c.notFound();
    return new Response(file, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  });

  app.get('/manifest.webmanifest', async (c) => {
    const file = Bun.file('./public/manifest.webmanifest');
    if (!(await file.exists())) return c.notFound();
    return new Response(file, {
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  });

  app.get('/sw.js', async (c) => {
    const file = Bun.file('./public/sw.js');
    if (!(await file.exists())) return c.notFound();
    return new Response(file, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Service-Worker-Allowed': '/',
      },
    });
  });

  let cachedRawIndexHtml: string | null = null;

  if (process.env.NODE_ENV === 'production') {
    app.use('/assets/*', serveStatic({ root: './dist/client' }));
  }

  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
    app.get('*', async (c) => {
      const candidatePath =
        process.env.NODE_ENV === 'production' ? './dist/client/index.html' : './index.html';
      const indexFile = Bun.file(candidatePath);
      if (!(await indexFile.exists())) {
        return c.text('Aplikasi sedang disiapkan (503 Service Unavailable)', 503);
      }

      if (!cachedRawIndexHtml || process.env.NODE_ENV !== 'production') {
        cachedRawIndexHtml = await indexFile.text();
      }

      const reqPath = c.req.path;
      const explicitErr = parseExplicitErrorRoute(reqPath);
      const status =
        typeof explicitErr === 'number'
          ? explicitErr
          : isKnownSpaPath(reqPath)
            ? 200
            : 404;

      const dynamicHtml = await injectDynamicHtmlMeta(
        cachedRawIndexHtml,
        resolveRequestOrigin(c)
      );

      return new Response(dynamicHtml, {
        status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    });
  }

  return app;
}

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { isKnownSpaPath, parseExplicitErrorRoute } from '../shared/routes';
import { securityHeaders } from './middleware/security';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { mediaRoutes } from './routes/media';
import { publicRoutes } from './routes/public';

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
  app.use('/uploads/*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
    );
  });
  app.use('/uploads/*', serveStatic({ root: './data' }));
  app.use('/brand/*', serveStatic({ root: './public' }));

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

  if (process.env.NODE_ENV === 'production') {
    app.use('/assets/*', serveStatic({ root: './dist/client' }));
    app.get('*', async (c) => {
      const indexFile = Bun.file('./dist/client/index.html');
      if (!(await indexFile.exists())) {
        return c.text('Aplikasi sedang disiapkan (503 Service Unavailable)', 503);
      }

      const reqPath = c.req.path;
      const explicitErr = parseExplicitErrorRoute(reqPath);
      const status =
        typeof explicitErr === 'number'
          ? explicitErr
          : isKnownSpaPath(reqPath)
            ? 200
            : 404;

      return new Response(indexFile, {
        status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    });
  }

  return app;
}

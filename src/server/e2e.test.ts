import { beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from './app';
import { seedDefaults } from './db';

describe('UAT & Security E2E Flow', () => {
  const app = createApp();
  let adminCookie = '';
  let mediaCookie = '';
  let tournamentId = 0;

  beforeAll(async () => {
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    await seedDefaults();
  });

  test('1. Public overview returns SVC & AVERSA branding', async () => {
    const res = await app.request('/api/public/overview');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.settings.eventName).toBe('Smansage Volleyball Competition');
    expect(data.settings.logoUrl).toBe('/brand/svc-crest-color.svg');
  });

  test('2. Auth & RBAC enforcement blocks unauthenticated & unauthorized access', async () => {
    // Unauthenticated admin access -> 401
    const unauth = await app.request('/api/admin/overview');
    expect(unauth.status).toBe(401);

    // Wrong password -> 401
    const badLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    expect(badLogin.status).toBe(401);

    // Media login -> 200, but admin route -> 403
    const mediaLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'media', password: 'media123' }),
    });
    expect(mediaLogin.status).toBe(200);
    mediaCookie = mediaLogin.headers.get('set-cookie')?.split(';')[0] ?? '';

    const mediaForbidden = await app.request('/api/admin/overview', {
      headers: { Cookie: mediaCookie },
    });
    expect(mediaForbidden.status).toBe(403);

    // Admin login -> 200
    const adminLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    expect(adminLogin.status).toBe(200);
    adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(adminCookie).toContain('ov_token=');
  });

  test('3. Technical Meeting 16-Team Draw, Inline Edit, Live Score, & Auto-Advance', async () => {
    // Create category with fast rules for E2E scoring
    const createRes = await app.request('/api/admin/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'SMP Putra E2E',
        bestOf: 3,
        regularSetPoints: 2,
        decidingSetPoints: 2,
        useDeuce: false,
        hasThirdPlace: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    tournamentId = created.tournament.id;

    // Initialize 16-team Draw (4+4 Pool A & B)
    const drawRes = await app.request(`/api/admin/tournaments/${tournamentId}/init-draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ slotCount: 16 }),
    });
    expect(drawRes.status).toBe(200);

    // Fetch admin overview to get teams & Match 1
    const ovRes = await app.request('/api/admin/overview', {
      headers: { Cookie: adminCookie },
    });
    const ov = await ovRes.json();
    const catTeams = ov.teams.filter((t: { tournamentId: number }) => t.tournamentId === tournamentId);
    expect(catTeams.length).toBe(16);

    // Inline edit Undian 01 & 02
    await app.request(`/api/admin/teams/${catTeams[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'SMPN 1 GEDEG', school: 'MOJOKERTO' }),
    });
    await app.request(`/api/admin/teams/${catTeams[1].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'SMPN 1 KEMLAGI', school: 'MOJOKERTO' }),
    });

    const catMatches = ov.matches.filter((m: { tournamentId: number }) => m.tournamentId === tournamentId);
    const match1 = catMatches.find((m: { round: number; matchIndex: number }) => m.round === 1 && m.matchIndex === 0);

    // Score Set 1 (2-0) -> confirm next set -> Score Set 2 (2-0) -> confirm match finish
    for (let i = 0; i < 2; i++) {
      const scoreRes = await app.request(`/api/admin/matches/${match1.id}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ action: 'point', team: 'A', delta: 1 }),
      });
      expect(scoreRes.status).toBe(200);
    }
    await app.request(`/api/admin/matches/${match1.id}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ action: 'confirm_set_next' }),
    });

    for (let i = 0; i < 2; i++) {
      const scoreRes = await app.request(`/api/admin/matches/${match1.id}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ action: 'point', team: 'A', delta: 1 }),
      });
      expect(scoreRes.status).toBe(200);
    }
    await app.request(`/api/admin/matches/${match1.id}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ action: 'confirm_match_finish' }),
    });

    // Verify public overview shows Match 1 finished and Team A advanced to QF 1
    const pubRes = await app.request('/api/public/overview');
    const pub = await pubRes.json();
    const pubMatch1 = pub.matches.find((m: { id: number }) => m.id === match1.id);
    const qf1 = pub.matches.find(
      (m: { tournamentId: number; round: number; matchIndex: number }) =>
        m.tournamentId === tournamentId && m.round === 2 && m.matchIndex === 0
    );

    expect(pubMatch1.status).toBe('finished');
    expect(pubMatch1.winnerId).toBe(catTeams[0].id);
    expect(qf1.teamAId).toBe(catTeams[0].id);
  });

  test('4. Security Upload Guard rejects SVG XSS and allows PNG Live Report', async () => {
    const ovRes = await app.request('/api/public/overview');
    const ov = await ovRes.json();
    const anyMatch = ov.matches.find((m: { tournamentId: number }) => m.tournamentId === tournamentId);

    // Attempt SVG upload -> should be rejected (400)
    const svgForm = new FormData();
    svgForm.append('file', new File(['<svg><script>alert(1)</script></svg>'], 'xss.svg', { type: 'image/svg+xml' }));
    svgForm.append('matchId', String(anyMatch.id));
    const svgRes = await app.request('/api/media/reports', {
      method: 'POST',
      headers: { Cookie: mediaCookie },
      body: svgForm,
    });
    expect(svgRes.status).toBe(400);

    // Attempt spoofed PNG (HTML polyglot renamed to .png with image/png MIME) -> rejected (400)
    const spoofForm = new FormData();
    spoofForm.append(
      'file',
      new File(['<html><script>alert(1)</script></html>'], 'spoof.png', {
        type: 'image/png',
      })
    );
    spoofForm.append('matchId', String(anyMatch.id));
    const spoofRes = await app.request('/api/media/reports', {
      method: 'POST',
      headers: { Cookie: mediaCookie },
      body: spoofForm,
    });
    expect(spoofRes.status).toBe(400);

    // Valid PNG upload -> 201, then cleanup
    const pngForm = new FormData();
    pngForm.append(
      'file',
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'moment.png', {
        type: 'image/png',
      })
    );
    pngForm.append('matchId', String(anyMatch.id));
    pngForm.append('caption', 'UAT E2E Moment');
    const pngRes = await app.request('/api/media/reports', {
      method: 'POST',
      headers: { Cookie: mediaCookie },
      body: pngForm,
    });
    expect(pngRes.status).toBe(201);
    const created = await pngRes.json();

    const delRes = await app.request(`/api/media/reports/${created.report.id}`, {
      method: 'DELETE',
      headers: { Cookie: mediaCookie },
    });
    expect(delRes.status).toBe(200);
  });

  test('5. Cloudflare Real IP & ETag 304 caching work for spike protection', async () => {
    const healthRes = await app.request('/api/public/health', {
      headers: { 'CF-Connecting-IP': '203.0.113.42' },
    });
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json();
    expect(health.clientIp).toBe('203.0.113.42');

    const ov1 = await app.request('/api/public/overview');
    const etag = ov1.headers.get('etag');
    expect(etag).toBeTruthy();

    const ov304 = await app.request('/api/public/overview', {
      headers: { 'If-None-Match': etag! },
    });
    expect(ov304.status).toBe(304);
  });

  test('6. TV Display PIN Gate protects VIP Priority SSE & hides PIN from public', async () => {
    const pubOv = await (await app.request('/api/public/overview')).json();
    expect(pubOv.settings.tvPin).toBeUndefined();

    // Unauthenticated TV stream -> 401
    const unauthTv = await app.request('/api/public/tv-stream');
    expect(unauthTv.status).toBe(401);

    // Admin/Panitia sets custom TV PIN
    const setPinRes = await app.request('/api/admin/tv-pin', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ tvPin: '8899' }),
    });
    expect(setPinRes.status).toBe(200);

    // Wrong PIN -> 401
    const wrongPin = await app.request('/api/public/tv-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '0000' }),
    });
    expect(wrongPin.status).toBe(401);

    // Correct PIN -> 200 + VIP cookie -> tv-check unlocked
    const okPin = await app.request('/api/public/tv-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '8899' }),
    });
    expect(okPin.status).toBe(200);
    const vipCookie = okPin.headers.get('set-cookie')?.split(';')[0] ?? '';

    const checkRes = await app.request('/api/public/tv-check', {
      headers: { Cookie: vipCookie },
    });
    const checkJson = await checkRes.json();
    expect(checkJson.unlocked).toBe(true);
  });

  test('7. Sponsor priority reordering updates order for Top-3 Principal display', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const addOne = async (name: string, category: 'sponsor' | 'media_partner') => {
      const fd = new FormData();
      fd.append('file', new File([pngBytes], `${name}.png`, { type: 'image/png' }));
      fd.append('name', name);
      fd.append('category', category);
      const r = await app.request('/api/admin/settings/sponsors', {
        method: 'POST',
        headers: { Cookie: adminCookie },
        body: fd,
      });
      expect(r.status).toBe(201);
      return r.json();
    };

    await addOne('Sponsor Alpha', 'sponsor');
    const afterTwo = await addOne('Media Beta', 'media_partner');
    const parsedBefore = JSON.parse(afterTwo.settings.sponsorsJson) as Array<{
      id: string;
      name: string;
    }>;
    const alpha = parsedBefore.find((s) => s.name === 'Sponsor Alpha')!;
    const beta = parsedBefore.find((s) => s.name === 'Media Beta')!;
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();

    // Non-admin blocked from reordering -> 403
    const forbidden = await app.request('/api/admin/settings/sponsors/reorder', {
      method: 'PUT',
      headers: { Cookie: mediaCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [beta.id, alpha.id] }),
    });
    expect(forbidden.status).toBe(403);

    // Admin puts Media Beta at #1 ahead of Sponsor Alpha
    const reorderRes = await app.request('/api/admin/settings/sponsors/reorder', {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [beta.id, alpha.id] }),
    });
    expect(reorderRes.status).toBe(200);
    const reorderJson = await reorderRes.json();
    const parsedAfter = JSON.parse(reorderJson.settings.sponsorsJson) as Array<{
      id: string;
      name: string;
    }>;
    expect(parsedAfter[0].id).toBe(beta.id);
    expect(parsedAfter[1].id).toBe(alpha.id);

    // Cleanup test sponsors
    for (const sp of [alpha, beta]) {
      await app.request(`/api/admin/settings/sponsors/${sp.id}`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      });
    }
  });

  test('8. PWA Manifest/SW, Security Headers, HTTPS Cookie, Role Allowlist & Rate Limiter', async () => {
    // 1. Security headers on API & static endpoints
    const ovRes = await app.request('/api/public/overview');
    expect(ovRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ovRes.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(ovRes.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');

    // 2. PWA Manifest & Service Worker served with valid headers
    const manifestRes = await app.request('/manifest.webmanifest');
    expect(manifestRes.status).toBe(200);
    expect(manifestRes.headers.get('content-type')).toContain('application/manifest+json');
    const manifest = await manifestRes.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const swRes = await app.request('/sw.js');
    expect(swRes.status).toBe(200);
    expect(swRes.headers.get('content-type')).toContain('application/javascript');
    expect(swRes.headers.get('cache-control')).toContain('no-cache');

    // 3. HTTPS proxy adds Secure attribute to session cookie
    const httpsLogin = await app.request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'CF-Connecting-IP': '198.51.100.77',
      },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    expect(httpsLogin.status).toBe(200);
    expect(httpsLogin.headers.get('set-cookie')).toContain('Secure');

    // 4. Strict role allowlist blocks arbitrary role string
    const badRoleRes = await app.request('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        username: 'rogue_role_user',
        name: 'Rogue Role',
        password: 'password123',
        role: 'superadmin',
      }),
    });
    expect(badRoleRes.status).toBe(400);

    // 5. Brute-force rate limiter blocks repeated wrong TV PIN attempts from one IP
    const attackerIp = '203.0.113.250';
    for (let i = 0; i < 8; i++) {
      const r = await app.request('/api/public/tv-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': attackerIp,
        },
        body: JSON.stringify({ pin: '0001' }),
      });
      expect(r.status).toBe(401);
    }

    const blockedRes = await app.request('/api/public/tv-auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': attackerIp,
      },
      body: JSON.stringify({ pin: '0001' }),
    });
    expect(blockedRes.status).toBe(429);
    expect(Number(blockedRes.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('9. Strict CSP (no unsafe-inline script), Stored XSS Sanitizer, API 404 & Maintenance 503', async () => {
    // 1. CSP blocks inline scripts and object embeds
    const res = await app.request('/api/public/overview');
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-inline' https://cdn.jsdelivr.net");
    expect(csp).toContain("object-src 'none'");

    const themeScriptRes = await app.request('/theme-init.js');
    expect(themeScriptRes.status).toBe(200);

    // 2. Stored XSS payload in Team Name & CSS injection in Team Color are stripped/sanitized
    const xssTeamRes = await app.request('/api/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        tournamentId,
        name: '<script>alert(1)</script>SMPN XSS<img src=x onerror=alert(1)>',
        school: '<svg onload=alert(1)>Mojokerto',
        color: '#fff;width:expression(alert(1))',
      }),
    });
    expect(xssTeamRes.status).toBe(201);
    const xssJson = await xssTeamRes.json();
    expect(xssJson.team.name).toBe('SMPN XSS');
    expect(xssJson.team.school).toBe('Mojokerto');
    expect(xssJson.team.color).toBe('#E09D17');

    // Cleanup test team
    await app.request(`/api/admin/teams/${xssJson.team.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });

    // 3. Unknown API route returns clean 404 JSON
    const api404 = await app.request('/api/unknown-route-xyz');
    expect(api404.status).toBe(404);

    // 4. Scheduled Maintenance Mode returns 503 Service Unavailable on public overview while keeping health 200
    process.env.MAINTENANCE_MODE = 'true';
    try {
      const maintRes = await app.request('/api/public/overview');
      expect(maintRes.status).toBe(503);
      expect(maintRes.headers.get('retry-after')).toBe('60');

      const healthDuringMaint = await app.request('/api/public/health');
      expect(healthDuringMaint.status).toBe(200);
    } finally {
      delete process.env.MAINTENANCE_MODE;
    }
  });

  test('10. Multi-Slide Photos & Video Upload in Galeri Momen', async () => {
    const ovBefore = await (await app.request('/api/public/overview')).json();
    const targetMatchId = ovBefore.matches[0].id as number;

    const validPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const validJpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    // ISO-BMFF MP4 header: size=20, "ftypisom"
    const validMp4 = new Uint8Array([
      0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02,
      0x00,
    ]);

    const fd = new FormData();
    fd.append('file', new File([validPng], 'poster.png', { type: 'image/png' }));
    fd.append('slides', new File([validJpg], 'slide1.jpg', { type: 'image/jpeg' }));
    fd.append('slides', new File([validJpg], 'slide2.jpg', { type: 'image/jpeg' }));
    fd.append('video', new File([validMp4], 'highlight.mp4', { type: 'video/mp4' }));
    fd.append('matchId', String(targetMatchId));
    fd.append('caption', 'Highlight Multi-Slide & Video');
    fd.append(
      'scoreSnapshot',
      JSON.stringify({ teamA: 'SMP1', teamB: 'SMP2', scoreText: 'Set 2-1' })
    );

    const createRes = await app.request('/api/media/reports', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: fd,
    });
    expect(createRes.status).toBe(201);
    const createdJson = await createRes.json();
    const mediaArr = JSON.parse(createdJson.report.mediaJson) as Array<{
      type: string;
      url: string;
    }>;
    // Expect 1 video + 1 poster + 2 extra slides = 4 items
    expect(mediaArr.length).toBe(4);
    expect(mediaArr[0]?.type).toBe('video');
    expect(mediaArr[0]?.url).toEndWith('.mp4');
    expect(mediaArr[1]?.type).toBe('image');

    // Spoofed fake video is rejected
    const badVideoFd = new FormData();
    badVideoFd.append('file', new File([validPng], 'poster.png', { type: 'image/png' }));
    badVideoFd.append(
      'video',
      new File([new TextEncoder().encode('<script>alert(1)</script>')], 'fake.mp4', {
        type: 'video/mp4',
      })
    );
    badVideoFd.append('matchId', String(targetMatchId));
    const badRes = await app.request('/api/media/reports', {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: badVideoFd,
    });
    expect(badRes.status).toBe(400);

    // Cleanup created multi-media report
    const delRes = await app.request(`/api/media/reports/${createdJson.report.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);
  });
});

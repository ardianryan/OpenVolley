import { beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from './app';
import { seedDefaults } from './db';

describe('Feature Suite — Tournament Lifecycle, Role Matrix & Production Routing', () => {
  const app = createApp();
  let adminCookie = '';
  let panitiaCookie = '';
  let mediaCookie = '';

  async function loginAs(username: string, password: string): Promise<string> {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    expect(res.status).toBe(200);
    const raw = res.headers.get('set-cookie') || '';
    return raw.split(';')[0] || '';
  }

  beforeAll(async () => {
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    await seedDefaults();
    adminCookie = await loginAs('admin', 'admin123');
    panitiaCookie = await loginAs('panitia', 'panitia123');
    mediaCookie = await loginAs('media', 'media123');
  });

  test('Feature 1: 3-Role Access Matrix (Admin vs Panitia vs Media)', async () => {
    // Media role cannot mutate brackets or branding
    const mediaTournamentBlock = await app.request('/api/admin/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: mediaCookie },
      body: JSON.stringify({ name: 'Unauthorized Cup', slug: 'unauth-cup' }),
    });
    expect(mediaTournamentBlock.status).toBe(403);

    // Panitia role can manage tournaments & live scores, but cannot overwrite global branding or accounts
    const panitiaBrandingBlock = await app.request('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({ eventName: 'Blocked Override' }),
    });
    expect(panitiaBrandingBlock.status).toBe(403);

    const panitiaUsersBlock = await app.request('/api/auth/users', {
      headers: { Cookie: panitiaCookie },
    });
    expect(panitiaUsersBlock.status).toBe(403);

    // Admin role can list users
    const adminUsersOk = await app.request('/api/auth/users', {
      headers: { Cookie: adminCookie },
    });
    expect(adminUsersOk.status).toBe(200);
  });

  test('Feature 2: 8-Team Draw Bracket, Schedule Metadata & Deuce Set Confirmation', async () => {
    const catRes = await app.request('/api/admin/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({
        name: 'Exhibition Feature Cup',
        slug: `feature-cup-${Date.now()}`,
        bestOf: 3,
        regularSetPoints: 15,
        decidingSetPoints: 15,
        useDeuce: true,
        hasThirdPlace: true,
      }),
    });
    expect(catRes.status).toBe(201);
    const { tournament } = await catRes.json();

    // Initialize 8-slot symmetric bracket (4 QF + 2 SF + 1 Final + 1 Third Place = 8 matches)
    const drawRes = await app.request(`/api/admin/tournaments/${tournament.id}/init-draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({ slotCount: 8 }),
    });
    expect(drawRes.status).toBe(200);
    const drawData = await drawRes.json();
    expect(drawData.matches.length).toBe(8);

    const qfMatch = drawData.matches.find((m: { round: number }) => m.round === 1);
    expect(qfMatch).toBeDefined();

    // Update court & schedule metadata
    const metaRes = await app.request(`/api/admin/matches/${qfMatch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({
        courtName: 'Court 1 Arena',
        scheduledAt: 'Sabtu, 08:30 WIB',
      }),
    });
    expect(metaRes.status).toBe(200);

    // Start match with custom quick-test set rule (Best of 3, 5 points, deuce active)
    const startRes = await app.request(`/api/admin/matches/${qfMatch.id}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({
        action: 'start',
        rules: {
          bestOf: 3,
          regularSetPoints: 5,
          decidingSetPoints: 5,
          useDeuce: true,
        },
      }),
    });
    expect(startRes.status).toBe(200);

    // Play Set 1 to 4-4 deuce: reaching 5-4 must NOT finish set yet because lead < 2
    for (let i = 0; i < 4; i++) {
      await app.request(`/api/admin/matches/${qfMatch.id}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
        body: JSON.stringify({ action: 'point', team: 'A', delta: 1 }),
      });
      await app.request(`/api/admin/matches/${qfMatch.id}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
        body: JSON.stringify({ action: 'point', team: 'B', delta: 1 }),
      });
    }

    // At 5-4 (1-point lead under deuce), pendingDecision must remain undefined
    const deuceAdvRes = await app.request(`/api/admin/matches/${qfMatch.id}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({ action: 'point', team: 'A', delta: 1 }),
    });
    expect(deuceAdvRes.status).toBe(200);
    const deuceAdvMatch = (await deuceAdvRes.json()).match;
    expect(deuceAdvMatch.pendingDecision).toBeUndefined();

    // Reaching 6-4 (2-point lead) triggers pendingDecision without auto-closing Set 1
    const setPointRes = await app.request(`/api/admin/matches/${qfMatch.id}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({ action: 'point', team: 'A', delta: 1 }),
    });
    expect(setPointRes.status).toBe(200);
    const setPointMatch = (await setPointRes.json()).match;
    expect(setPointMatch.pendingDecision).toBeDefined();
    expect(setPointMatch.currentSet).toBe(1);

    // Explicit referee confirmation advances to Set 2
    const confirmSet1 = await app.request(`/api/admin/matches/${qfMatch.id}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({ action: 'confirm_set_next' }),
    });
    expect(confirmSet1.status).toBe(200);
    const confirmedMatch = (await confirmSet1.json()).match;
    expect(confirmedMatch.setsWonA).toBe(1);
    expect(confirmedMatch.currentSet).toBe(2);

    // Cleanup test tournament & verify full cascade deletion of teams + matches + sets
    const delCat = await app.request(`/api/admin/tournaments/${tournament.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delCat.status).toBe(200);
    const delSummary = await delCat.json();
    expect(delSummary.deletedTeams).toBe(8);
    expect(delSummary.deletedMatches).toBe(8);

    const ovAfterDel = await (await app.request('/api/public/overview')).json();
    expect(
      ovAfterDel.tournaments.some((t: { id: number }) => t.id === tournament.id)
    ).toBe(false);
    expect(
      ovAfterDel.teams.some((t: { tournamentId: number }) => t.tournamentId === tournament.id)
    ).toBe(false);
    expect(
      ovAfterDel.matches.some((m: { tournamentId: number }) => m.tournamentId === tournament.id)
    ).toBe(false);
  });

  test('Feature 3: Health Endpoint & ETag Conditional 304 Caching', async () => {
    const healthRes = await app.request('/api/public/health');
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json();
    expect(health.ok).toBe(true);
    expect(typeof health.overviewVersion).toBe('number');

    const firstOverview = await app.request('/api/public/overview');
    expect(firstOverview.status).toBe(200);
    const etag = firstOverview.headers.get('etag');
    expect(etag).toBeTruthy();

    const cachedOverview = await app.request('/api/public/overview', {
      headers: { 'If-None-Match': etag! },
    });
    expect(cachedOverview.status).toBe(304);
  });

  test('Feature 4: Self-Service Password Change & Admin User Password Reset', async () => {
    // Create a temporary account via Admin
    const createRes = await app.request('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        username: `pwd_tester_${Date.now()}`,
        name: 'Password Tester',
        password: 'initialPassword1',
        role: 'panitia',
      }),
    });
    expect(createRes.status).toBe(201);
    const { user: createdUser } = await createRes.json();

    const testerCookie = await loginAs(createdUser.username, 'initialPassword1');

    // 1. Self-service password change rejects wrong current password
    const wrongOldRes = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: testerCookie },
      body: JSON.stringify({
        currentPassword: 'wrongOldPassword',
        newPassword: 'newSecurePassword2',
      }),
    });
    expect(wrongOldRes.status).toBe(401);

    // 2. Self-service password change rejects too-short password (< 6 chars)
    const shortRes = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: testerCookie },
      body: JSON.stringify({
        currentPassword: 'initialPassword1',
        newPassword: '123',
      }),
    });
    expect(shortRes.status).toBe(400);

    // 3. Valid self-service password change succeeds & updates login credential
    const validChangeRes = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: testerCookie },
      body: JSON.stringify({
        currentPassword: 'initialPassword1',
        newPassword: 'newSecurePassword2',
      }),
    });
    expect(validChangeRes.status).toBe(200);
    await loginAs(createdUser.username, 'newSecurePassword2');

    // 4. Non-admin cannot reset other users via PUT /api/auth/users/:id
    const nonAdminReset = await app.request(`/api/auth/users/${createdUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({ password: 'hackedPassword9' }),
    });
    expect(nonAdminReset.status).toBe(403);

    // 5. Admin can reset user password & update display name
    const adminResetRes = await app.request(`/api/auth/users/${createdUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Updated Operator Name',
        role: 'media',
        password: 'adminResetPassword3',
      }),
    });
    expect(adminResetRes.status).toBe(200);
    const updatedJson = await adminResetRes.json();
    expect(updatedJson.user.name).toBe('Updated Operator Name');
    expect(updatedJson.user.role).toBe('media');
    await loginAs(createdUser.username, 'adminResetPassword3');

    // 6. Admin cannot demote their own active admin role
    const meRes = await (
      await app.request('/api/auth/me', { headers: { Cookie: adminCookie } })
    ).json();
    const selfDemoteRes = await app.request(`/api/auth/users/${meRes.user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ role: 'panitia' }),
    });
    expect(selfDemoteRes.status).toBe(400);

    // Cleanup temporary user
    const delRes = await app.request(`/api/auth/users/${createdUser.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delRes.status).toBe(200);
  });

  test('Feature 5: Per-Set Timeouts (0..2) & Substitutions (0..6) with Undo & Set Reset', async () => {
    const catRes = await (
      await app.request('/api/admin/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          name: 'Timeout Sub Test',
          bestOf: 3,
          regularSetPoints: 2,
          decidingSetPoints: 2,
          useDeuce: false,
        }),
      })
    ).json();
    const tid = catRes.tournament.id as number;

    await app.request(`/api/admin/tournaments/${tid}/init-draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ slotCount: 4 }),
    });

    const ov = await (
      await app.request('/api/admin/overview', { headers: { Cookie: adminCookie } })
    ).json();
    const matchId = ov.matches.find((m: { tournamentId: number }) => m.tournamentId === tid)
      .id as number;

    // Start match
    await app.request(`/api/admin/matches/${matchId}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({ action: 'start' }),
    });

    // Record 2 timeouts + try a 3rd (capped at 2) and 1 substitution
    for (let i = 0; i < 3; i++) {
      await app.request(`/api/admin/matches/${matchId}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
        body: JSON.stringify({ action: 'timeout', team: 'A', delta: 1 }),
      });
    }
    const subRes = await (
      await app.request(`/api/admin/matches/${matchId}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
        body: JSON.stringify({ action: 'sub', team: 'B', delta: 1 }),
      })
    ).json();
    expect(subRes.match.sets[0].timeoutsA).toBe(2);
    expect(subRes.match.sets[0].subsB).toBe(1);

    // Undo reverts substitution back to 0
    const afterUndo = await (
      await app.request(`/api/admin/matches/${matchId}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
        body: JSON.stringify({ action: 'undo' }),
      })
    ).json();
    expect(afterUndo.match.sets[0].subsB).toBe(0);
    expect(afterUndo.match.sets[0].timeoutsA).toBe(2);

    // Win Set 1 -> Set 2 starts fresh with 0 timeouts/subs while Set 1 keeps timeoutsA = 2
    await app.request(`/api/admin/matches/${matchId}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({ action: 'point', team: 'A', delta: 1 }),
    });
    await app.request(`/api/admin/matches/${matchId}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
      body: JSON.stringify({ action: 'point', team: 'A', delta: 1 }),
    });
    const nextSetJson = await (
      await app.request(`/api/admin/matches/${matchId}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: panitiaCookie },
        body: JSON.stringify({ action: 'confirm_set_next' }),
      })
    ).json();

    expect(nextSetJson.match.currentSet).toBe(2);
    expect(nextSetJson.match.sets[0].timeoutsA).toBe(2);
    expect(nextSetJson.match.sets[1].timeoutsA).toBe(0);
    expect(nextSetJson.match.sets[1].subsA).toBe(0);

    await app.request(`/api/admin/tournaments/${tid}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
  });

  test('Feature 6: Pool Stage (Round-Robin) Generation & Advancement to Knockout', async () => {
    const catRes = await (
      await app.request('/api/admin/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          name: 'Pool Knockout Category',
          format: 'pool_knockout',
          poolCount: 2,
          advancePerPool: 2,
          bestOf: 3,
        }),
      })
    ).json();
    const tid = catRes.tournament.id as number;

    await app.request('/api/admin/teams/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        tournamentId: tid,
        lines: [
          'SMPN 1 | Mojokerto',
          'SMPN 2 | Mojokerto',
          'SMPN 3 | Mojokerto',
          'SMPN 4 | Mojokerto',
        ].join('\n'),
      }),
    });

    const genPoolRes = await app.request(`/api/admin/tournaments/${tid}/generate-pools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ poolCount: 2, advancePerPool: 2, shuffle: false }),
    });
    expect(genPoolRes.status).toBe(200);
    const genPoolJson = await genPoolRes.json();

    const poolMatches = genPoolJson.matches.filter(
      (m: { bracketType: string }) => m.bracketType === 'pool'
    );
    const mainMatches = genPoolJson.matches.filter(
      (m: { bracketType: string }) => m.bracketType === 'main'
    );
    // 2 pools of 2 teams -> 1 match per pool = 2 pool matches + 2 semifinals + 1 final = 3 main matches
    expect(poolMatches.length).toBe(2);
    expect(mainMatches.length).toBe(3);
    expect(mainMatches[0].stageLabel).toContain('Winner Pool A');

    // Finish both pool matches manually & advance qualifiers into Semi-Finals
    for (const pm of poolMatches) {
      await app.request(`/api/admin/matches/${pm.id}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ action: 'finish', team: 'A' }),
      });
    }

    const advRes = await app.request(`/api/admin/tournaments/${tid}/advance-pools`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(advRes.status).toBe(200);
    const advJson = await advRes.json();
    const populatedSemis = advJson.matches.filter(
      (m: { bracketType: string; round: number }) =>
        m.bracketType === 'main' && m.round === 1
    );
    expect(populatedSemis.every((m: { teamAId: number; teamBId: number }) => m.teamAId && m.teamBId)).toBe(true);

    await app.request(`/api/admin/tournaments/${tid}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
  });

  test('Feature 7: Dynamic Favicon/SEO HTML Injection, 1200x630 OG PNG & SSRF-Safe Asset Proxy', async () => {
    // 1. Dynamic HTML meta & SVC Crest favicon injection
    const htmlRes = await app.request('http://openvolley.local/');
    expect(htmlRes.status).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('href="/brand/svc-crest-color.svg"');
    expect(htmlText).toContain('property="og:image"');
    expect(htmlText).toContain('http://openvolley.local/api/public/og-image.png');

    // 2. Auto-generated 1200x630 PNG via @resvg/resvg-wasm
    const ogRes = await app.request('/api/public/og-image.png');
    expect(ogRes.status).toBe(200);
    expect(ogRes.headers.get('content-type')).toBe('image/png');
    const ogBytes = new Uint8Array(await ogRes.arrayBuffer());
    // Verify PNG signature (89 50 4E 47) & IHDR width=1200 (0x04B0), height=630 (0x0276)
    expect(ogBytes[0]).toBe(0x89);
    expect(ogBytes[1]).toBe(0x50);
    expect(ogBytes[2]).toBe(0x4e);
    expect(ogBytes[3]).toBe(0x47);
    const view = new DataView(ogBytes.buffer);
    expect(view.getUint32(16, false)).toBe(1200);
    expect(view.getUint32(20, false)).toBe(630);

    // 3. Asset proxy strictly blocks loopback / private IPs & arbitrary external domains (SSRF guard)
    const loopbackBlock = await app.request(
      '/api/public/asset-proxy?url=' + encodeURIComponent('http://127.0.0.1:3000/api/public/health')
    );
    expect(loopbackBlock.status).toBe(403);

    const arbitraryBlock = await app.request(
      '/api/public/asset-proxy?url=' + encodeURIComponent('https://example.com/evil.png')
    );
    expect(arbitraryBlock.status).toBe(403);
  });

  test('Feature 8: Real-Time VIP TV SSE Stream — Live Point Movement & Instant Final Set Transition', async () => {
    // 1. Verify /api/public/overview uses no-cache + ETag (never stale max-age window)
    const ovCheck = await app.request('/api/public/overview');
    expect(ovCheck.headers.get('cache-control')).toContain('no-cache');

    // 2. Create a quick 2-team match
    const catRes = await app.request('/api/admin/tournaments', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'TV SSE Test Cup',
        bestOf: 3,
        regularSetPoints: 5,
        decidingSetPoints: 5,
        useDeuce: false,
      }),
    });
    const { tournament } = await catRes.json();
    const tid = tournament.id as number;

    await app.request(`/api/admin/tournaments/${tid}/init-draw`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotCount: 4 }),
    });
    const ovInit = await (
      await app.request('/api/admin/overview', { headers: { Cookie: adminCookie } })
    ).json();
    const matchId = ovInit.matches.find(
      (m: { tournamentId: number; round: number }) => m.tournamentId === tid && m.round === 1
    ).id as number;

    // 3. Open VIP TV SSE stream with admin cookie and read real-time chunks
    const abortCtrl = new AbortController();
    const sseRes = await app.request(
      new Request('http://localhost/api/public/tv-stream', {
        headers: { Cookie: adminCookie },
        signal: abortCtrl.signal,
      })
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('x-accel-buffering')).toBe('no');
    expect(sseRes.headers.get('cache-control')).toContain('no-transform');

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    // Continuously drain stream in background just like browser EventSource
    const pumpTask = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
        }
      } catch {
        // aborted on cleanup
      }
    })();

    const waitForSse = async (predicate: (buf: string) => boolean) => {
      for (let i = 0; i < 40 && !predicate(sseBuffer); i++) {
        await new Promise((r) => setTimeout(r, 15));
      }
    };

    await waitForSse((b) => b.includes('event: connected'));
    expect(sseBuffer).toContain('event: connected');

    // 4. Start match & score Set 1 to 5-0 -> confirm next set -> score Set 2 to 4-2 -> finish match
    await app.request(`/api/admin/matches/${matchId}/score`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });

    for (let i = 0; i < 5; i++) {
      await app.request(`/api/admin/matches/${matchId}/score`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'point', team: 'A', delta: 1 }),
      });
    }
    await waitForSse((b) => b.includes('"scoreA":5'));
    expect(sseBuffer).toContain('"scoreA":5');

    await app.request(`/api/admin/matches/${matchId}/score`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm_set_next' }),
    });

    // Score 4-2 in Set 2 and trigger manual finish ("Menangkan ALP") to verify last set is closed & counted!
    for (let i = 0; i < 4; i++) {
      await app.request(`/api/admin/matches/${matchId}/score`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'point', team: 'A', delta: 1 }),
      });
    }
    for (let i = 0; i < 2; i++) {
      await app.request(`/api/admin/matches/${matchId}/score`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'point', team: 'B', delta: 1 }),
      });
    }

    sseBuffer = '';
    const finRes = await app.request(`/api/admin/matches/${matchId}/score`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'finish', team: 'A' }),
    });
    expect(finRes.status).toBe(200);

    await waitForSse((b) => b.includes('"status":"finished"'));
    expect(sseBuffer).toContain('event: match_updated');
    expect(sseBuffer).toContain('"status":"finished"');
    expect(sseBuffer).toContain('"setsWonA":2');
    expect(sseBuffer).toContain('"setsWonB":0');
    expect(sseBuffer).toContain('"scoreA":4,"scoreB":2');

    abortCtrl.abort();
    await reader.cancel().catch(() => {});
    await pumpTask;

    await app.request(`/api/admin/tournaments/${tid}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
  });

  test('Feature 9: Master Contingents Registry, Tab-Bulk Import, TM Draw Slot SSE & Per-Category Override', async () => {
    const uniqueSuffix = Date.now().toString(36);
    const schoolAName = `SMAN 99 Test ${uniqueSuffix}`;
    const kabBName = `Kab. Test ${uniqueSuffix}`;

    // 1. Bulk import Google Sheets Tab-separated rows (with header + duplicate row)
    const bulkLines = [
      'No\tNama Sekolah\tKab/Kota',
      `1\t${schoolAName}\tKab. Mojokerto`,
      `2\t${kabBName}\tJawa Timur`,
      `3\t${schoolAName}\tKab. Mojokerto`,
    ].join('\n');

    const bulkRes = await app.request('/api/admin/master-teams/bulk', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: bulkLines }),
    });
    expect(bulkRes.status).toBe(201);
    const bulkJson = await bulkRes.json();
    expect(bulkJson.insertedCount).toBe(2);
    expect(bulkJson.skippedCount).toBe(1);

    const masterA = bulkJson.masterTeams.find((m: { name: string }) => m.name === schoolAName);
    const masterB = bulkJson.masterTeams.find((m: { name: string }) => m.name === kabBName);
    expect(masterA.level).toBe('sma');
    expect(masterB.level).toBe('kab_kota');

    // Set default coach on Master A before drawing into categories
    await app.request(`/api/admin/master-teams/${masterA.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultCoachName: 'Coach Utama Default' }),
    });

    // 2. Create Putra & Putri categories and initialize 4-slot TM Brackets
    const putraRes = await app.request('/api/admin/tournaments', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `SMA Putra ${uniqueSuffix}` }),
    });
    const putraId = (await putraRes.json()).tournament.id as number;

    const putriRes = await app.request('/api/admin/tournaments', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `SMA Putri ${uniqueSuffix}` }),
    });
    const putriId = (await putriRes.json()).tournament.id as number;

    await app.request(`/api/admin/tournaments/${putraId}/init-draw`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotCount: 4 }),
    });
    await app.request(`/api/admin/tournaments/${putriId}/init-draw`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotCount: 4 }),
    });

    const ovSlots = await (
      await app.request('/api/admin/overview', { headers: { Cookie: adminCookie } })
    ).json();
    const putraSlots = ovSlots.teams
      .filter((t: { tournamentId: number }) => t.tournamentId === putraId)
      .sort((a: { seed: number }, b: { seed: number }) => a.seed - b.seed);
    const putriSlots = ovSlots.teams
      .filter((t: { tournamentId: number }) => t.tournamentId === putriId)
      .sort((a: { seed: number }, b: { seed: number }) => a.seed - b.seed);

    // 3. Connect VIP TV SSE stream and assign Master A to Putra Slot #01 & Putri Slot #01
    const abortCtrl = new AbortController();
    const sseRes = await app.request(
      new Request('http://localhost/api/public/tv-stream', {
        headers: { Cookie: adminCookie },
        signal: abortCtrl.signal,
      })
    );
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';
    const pump = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
        }
      } catch {
        // aborted on cleanup
      }
    })();

    const assignPutra1 = await app.request(`/api/admin/tournaments/${putraId}/draw-slot`, {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotTeamId: putraSlots[0].id, masterTeamId: masterA.id }),
    });
    expect(assignPutra1.status).toBe(200);

    for (let i = 0; i < 30 && !sseBuf.includes('event: draw_slot_updated'); i++) {
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(sseBuf).toContain('event: draw_slot_updated');
    expect(sseBuf).toContain(schoolAName);

    // Duplicate guard in same category without squadLabel -> 409 Conflict
    const dupRes = await app.request(`/api/admin/tournaments/${putraId}/draw-slot`, {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotTeamId: putraSlots[1].id, masterTeamId: masterA.id }),
    });
    expect(dupRes.status).toBe(409);

    // Secondary squad (`squadLabel: 'B'`) in same category -> 200 OK (`... (Tim B)`)
    const squadBRes = await app.request(`/api/admin/tournaments/${putraId}/draw-slot`, {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slotTeamId: putraSlots[1].id,
        masterTeamId: masterA.id,
        squadLabel: 'B',
      }),
    });
    expect(squadBRes.status).toBe(200);
    expect((await squadBRes.json()).team.name).toBe(`${schoolAName} (Tim B)`);

    // Same Master A in Putri category without re-entering identity -> 200 OK
    const assignPutri1 = await app.request(`/api/admin/tournaments/${putriId}/draw-slot`, {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotTeamId: putriSlots[0].id, masterTeamId: masterA.id }),
    });
    expect(assignPutri1.status).toBe(200);

    // 4. Override coachName ONLY on Putri, then update Master A's name & defaultCoachName
    await app.request(`/api/admin/teams/${putriSlots[0].id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachName: 'Coach Khusus Putri' }),
    });

    const renamedSchool = `SMAN 99 Unggulan ${uniqueSuffix}`;
    const patchMasterRes = await app.request(`/api/admin/master-teams/${masterA.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: renamedSchool,
        defaultCoachName: 'Coach Utama Baru',
      }),
    });
    expect(patchMasterRes.status).toBe(200);

    const ovAfter = await (
      await app.request('/api/admin/overview', { headers: { Cookie: adminCookie } })
    ).json();
    const putraSlot1After = ovAfter.teams.find(
      (t: { id: number }) => t.id === putraSlots[0].id
    );
    const putraSlot2After = ovAfter.teams.find(
      (t: { id: number }) => t.id === putraSlots[1].id
    );
    const putriSlot1After = ovAfter.teams.find(
      (t: { id: number }) => t.id === putriSlots[0].id
    );

    // Identity propagated everywhere; Putra inherited new default coach; Putri kept its custom coach!
    expect(putraSlot1After.name).toBe(renamedSchool);
    expect(putraSlot2After.name).toBe(`${renamedSchool} (Tim B)`);
    expect(putraSlot1After.coachName).toBe('Coach Utama Baru');
    expect(putriSlot1After.name).toBe(renamedSchool);
    expect(putriSlot1After.coachName).toBe('Coach Khusus Putri');

    // Cleanup SSE & temporary test rows
    abortCtrl.abort();
    await reader.cancel().catch(() => {});
    await pump;

    await app.request(`/api/admin/tournaments/${putraId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    await app.request(`/api/admin/tournaments/${putriId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    await app.request(`/api/admin/master-teams/${masterA.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    await app.request(`/api/admin/master-teams/${masterB.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
  });

  test('Feature 10: Master Courts, Cross-Court Schedule Transfer, Remote Multi-TV SSE & Public TV Gate', async () => {
    // 1. Create Master Court & Tournament with 4-slot bracket
    const cRes = await app.request('/api/admin/master-courts', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lapangan VIP Timur', shortCode: 'VIP-T' }),
    });
    expect(cRes.status).toBe(201);
    const courtCreated = (await cRes.json()).court as { id: number; name: string };

    const tRes = await app.request('/api/admin/tournaments', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'TV Remote & Courts Cup' }),
    });
    const tid = (await tRes.json()).tournament.id as number;
    await app.request(`/api/admin/tournaments/${tid}/init-draw`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotCount: 4 }),
    });

    const ov1 = await (
      await app.request('/api/admin/overview', { headers: { Cookie: adminCookie } })
    ).json();
    const catMatches = ov1.matches.filter(
      (m: { tournamentId: number; bracketType: string }) =>
        m.tournamentId === tid && m.bracketType === 'main'
    );
    expect(catMatches.length).toBeGreaterThanOrEqual(2);

    // 2. Bulk pull & assign schedule slot onto Master Court
    const bulkAssign = await app.request('/api/admin/matches/bulk-schedule-assign', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [
          {
            matchId: catMatches[0].id,
            courtName: courtCreated.name,
            scheduledAt: 'Jumat, 27 Nov 2026 • 13.00 - 14.00',
          },
        ],
      }),
    });
    expect(bulkAssign.status).toBe(200);
    expect((await bulkAssign.json()).count).toBe(1);

    // Rename Master Court and confirm match.courtName cascades automatically
    const renameCourt = await app.request(`/api/admin/master-courts/${courtCreated.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Arena Utama Timur' }),
    });
    expect(renameCourt.status).toBe(200);
    const matchAfterRename = await (
      await app.request(`/api/public/matches/${catMatches[0].id}`)
    ).json();
    expect(matchAfterRename.match.courtName).toBe('Arena Utama Timur');

    // 3. Create Multi-TV Screen Profile & Connect VIP SSE to test Remote Push
    const tvCreate = await app.request('/api/admin/tv-screens', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'TV Proyektor Aula TM',
        slug: 'proyektor-aula-test',
        courtId: courtCreated.id,
      }),
    });
    expect(tvCreate.status).toBe(201);
    const tvScreen = (await tvCreate.json()).screen as { id: number; slug: string };

    const pubScreenGet = await app.request(`/api/public/tv-screens/${tvScreen.slug}`);
    expect(pubScreenGet.status).toBe(200);
    expect((await pubScreenGet.json()).screen.slug).toBe('proyektor-aula-test');

    const abortCtrl = new AbortController();
    const sseRes = await app.request(
      new Request('http://localhost/api/public/tv-stream', {
        headers: { Cookie: adminCookie },
        signal: abortCtrl.signal,
      })
    );
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';
    const pump = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
        }
      } catch {
        // aborted on cleanup
      }
    })();

    // Admin remotely switches screen to Standby Banner (TM Preset + Marquee)
    const remotePatch = await app.request(`/api/admin/tv-screens/${tvScreen.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'standby',
        bannerPreset: 'tm',
        bannerBadge: 'STANDBY TM',
        bannerTitle: 'TECHNICAL MEETING SVC',
        bannerNoticeText: 'Harap seluruh manajer bersiap di ruang aula.',
      }),
    });
    expect(remotePatch.status).toBe(200);

    for (let i = 0; i < 30 && !sseBuf.includes('event: tv_screen_updated'); i++) {
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(sseBuf).toContain('event: tv_screen_updated');
    expect(sseBuf).toContain('proyektor-aula-test');
    expect(sseBuf).toContain('TECHNICAL MEETING SVC');

    abortCtrl.abort();
    await reader.cancel().catch(() => {});
    await pump;

    // 4. Verify publicTvEnabled defaults to false & toggles cleanly
    const checkDefault = await (await app.request('/api/public/tv-check')).json();
    expect(checkDefault.publicTvEnabled).toBe(false);

    await app.request('/api/admin/settings', {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicTvEnabled: true }),
    });
    const checkOpened = await (await app.request('/api/public/tv-check')).json();
    expect(checkOpened.publicTvEnabled).toBe(true);

    // Restore publicTvEnabled = false & clean up temporary rows
    await app.request('/api/admin/settings', {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicTvEnabled: false }),
    });
    await app.request(`/api/admin/tv-screens/${tvScreen.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    await app.request(`/api/admin/master-courts/${courtCreated.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    await app.request(`/api/admin/tournaments/${tid}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
  });

  test('Feature 11: Comprehensive Granular RBAC (Custom Roles & Per-User Permissions), Live JWT Revocation & Security Hardening', async () => {
    // 1. Admin creates a Custom Role with ONLY 'operator' permission
    const roleRes = await app.request('/api/auth/roles', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Wasit Skor Meja',
        description: 'Hanya akses Live Operator',
        permissions: ['operator'],
      }),
    });
    expect(roleRes.status).toBe(201);
    const createdRole = (await roleRes.json()).role as {
      id: number;
      slug: string;
      permissions: string[];
    };
    expect(createdRole.slug).toBe('wasit_skor_meja');
    expect(createdRole.permissions).toEqual(['operator']);

    // System role deletion is blocked -> 400
    const rolesListRes = await (
      await app.request('/api/auth/roles', { headers: { Cookie: adminCookie } })
    ).json();
    const panitiaRole = rolesListRes.roles.find((r: { slug: string }) => r.slug === 'panitia');
    const delSysRole = await app.request(`/api/auth/roles/${panitiaRole.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delSysRole.status).toBe(400);

    // 2. Create user under Custom Role -> inherits ['operator']
    const userCreateRes = await app.request('/api/auth/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'wasit_meja_1',
        name: 'Petugas Wasit 1',
        password: 'password123',
        role: createdRole.slug,
      }),
    });
    expect(userCreateRes.status).toBe(201);
    const createdUser = (await userCreateRes.json()).user as {
      id: number;
      permissions: string[];
    };
    expect(createdUser.permissions).toEqual(['operator']);

    const loginWasit = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'wasit_meja_1', password: 'password123' }),
    });
    expect(loginWasit.status).toBe(200);
    const wasitCookie = loginWasit.headers.get('set-cookie')?.split(';')[0] ?? '';

    // 3. Enforce endpoint RBAC strictly + redact tvPin from overview
    const ovWasit = await app.request('/api/admin/overview', {
      headers: { Cookie: wasitCookie },
    });
    expect(ovWasit.status).toBe(200);
    expect((await ovWasit.json()).settings.tvPin).toBeUndefined();

    const blockedTv = await app.request('/api/admin/tv-screens', {
      headers: { Cookie: wasitCookie },
    });
    expect(blockedTv.status).toBe(403);

    const blockedMaster = await app.request('/api/admin/master-teams', {
      method: 'POST',
      headers: { Cookie: wasitCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Be Blocked' }),
    });
    expect(blockedMaster.status).toBe(403);

    // Allowed route ('operator') clears middleware (400 on dummy matchId, NOT 403)
    const allowedScore = await app.request('/api/admin/matches/999999/score', {
      method: 'POST',
      headers: { Cookie: wasitCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });
    expect(allowedScore.status).toBe(400);

    // 4. Per-User custom permission override takes effect IMMEDIATELY without re-login
    const overrideRes = await app.request(`/api/auth/users/${createdUser.id}`, {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['operator', 'tv_screens'] }),
    });
    expect(overrideRes.status).toBe(200);

    const meAfterOverride = await (
      await app.request('/api/auth/me', { headers: { Cookie: wasitCookie } })
    ).json();
    expect(meAfterOverride.user.permissions).toEqual(['operator', 'tv_screens']);

    const unlockedTv = await app.request('/api/admin/tv-screens', {
      headers: { Cookie: wasitCookie },
    });
    expect(unlockedTv.status).toBe(200);

    // 5. Deleting user IMMEDIATELY revokes old 7-day JWT -> 401 Unauthorized
    await app.request(`/api/auth/users/${createdUser.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    const staleJwtCheck = await app.request('/api/auth/me', {
      headers: { Cookie: wasitCookie },
    });
    expect(staleJwtCheck.status).toBe(401);

    // Delete now-unused custom role cleanly
    const delCustomRole = await app.request(`/api/auth/roles/${createdRole.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(delCustomRole.status).toBe(200);

    // 6. Security Audit: Host header injection guard blocks spoofed X-Forwarded-Host
    const poisonedHtml = await (
      await app.request('http://localhost/', {
        headers: { 'X-Forwarded-Host': 'evil.attacker.com/phish' },
      })
    ).text();
    expect(poisonedHtml).not.toContain('evil.attacker.com');
  });

  test('Feature 12: Category Rules Editor & Cloudflare Turnstile Gate + Login Verification', async () => {
    // 1. Edit tournament category game rules via PATCH /api/admin/tournaments/:id
    const createRes = await app.request('/api/admin/tournaments', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kategori Awal',
        bestOf: 3,
        regularSetPoints: 25,
        decidingSetPoints: 15,
        useDeuce: true,
        hasThirdPlace: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const { tournament } = await createRes.json();

    const patchRes = await app.request(`/api/admin/tournaments/${tournament.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kategori Revisi Bo5',
        bestOf: 5,
        regularSetPoints: 21,
        decidingSetPoints: 15,
        useDeuce: false,
        hasThirdPlace: false,
      }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.tournament.name).toBe('Kategori Revisi Bo5');
    expect(patched.tournament.bestOf).toBe(5);
    expect(patched.tournament.regularSetPoints).toBe(21);
    expect(patched.tournament.useDeuce).toBe(false);
    expect(patched.tournament.hasThirdPlace).toBe(false);

    // 2. Verify CSP includes Cloudflare Turnstile origins
    const healthRes = await app.request('/api/public/health');
    const csp = healthRes.headers.get('content-security-policy') || '';
    expect(csp).toContain('https://challenges.cloudflare.com');

    // 3. Turnstile gate & login verification with mocked siteverify
    const originalFetch = globalThis.fetch;
    process.env.TURNSTILE_SITE_KEY = '0x4TEST_SITE_KEY';
    process.env.TURNSTILE_SECRET_KEY = '0x4TEST_SECRET_KEY';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('challenges.cloudflare.com/turnstile/v0/siteverify')) {
        const bodyText = init?.body ? init.body.toString() : '';
        const params = new URLSearchParams(bodyText);
        const token = params.get('response');
        return new Response(
          JSON.stringify({
            success: token === 'valid-cf-token',
            action: token === 'valid-cf-token' ? undefined : 'mismatch',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const cfgRes = await app.request('/api/public/turnstile-config');
      expect(cfgRes.status).toBe(200);
      const cfg = await cfgRes.json();
      expect(cfg.enabled).toBe(true);
      expect(cfg.siteKey).toBe('0x4TEST_SITE_KEY');
      expect(cfg.verified).toBe(false);

      // Invalid public Turnstile token -> 403
      const badGate = await app.request('/api/public/verify-turnstile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'bad-token' }),
      });
      expect(badGate.status).toBe(403);

      // Valid public Turnstile token -> 200 + ov_human cookie
      const okGate = await app.request('/api/public/verify-turnstile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-cf-token' }),
      });
      expect(okGate.status).toBe(200);
      const humanCookie = (okGate.headers.get('set-cookie') || '').split(';')[0] || '';
      expect(humanCookie).toContain('ov_human=');

      const cfgAfter = await app.request('/api/public/turnstile-config', {
        headers: { Cookie: humanCookie },
      });
      expect((await cfgAfter.json()).verified).toBe(true);

      // Admin login without Turnstile token -> 403
      const missingLoginToken = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      });
      expect(missingLoginToken.status).toBe(403);

      // Admin login with valid Turnstile token -> 200
      const okLogin = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'admin123',
          turnstileToken: 'valid-cf-token',
        }),
      });
      expect(okLogin.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.TURNSTILE_SITE_KEY;
      delete process.env.TURNSTILE_SECRET_KEY;
    }
  });

  test('Feature 13: v0.3.0 OBS Token Gate & Variations, Roster/Set Duration, i18n, Webhooks & SQLite Backup', async () => {
    // 1. OBS Overlays CRUD + Token Gate
    const createObs = await app.request('/api/admin/obs-overlays', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Stream Court 1',
        layoutPreset: 'scorebug_corner',
        themeMode: 'glass',
      }),
    });
    expect(createObs.status).toBe(201);
    const { overlay } = await createObs.json();
    expect(overlay.accessToken.length).toBeGreaterThanOrEqual(12);
    expect(overlay.layoutPreset).toBe('scorebug_corner');

    // Missing or wrong token -> 403 Forbidden
    const unauthObsState = await app.request(
      `/api/public/obs-state?overlay=${overlay.slug}`
    );
    expect(unauthObsState.status).toBe(403);

    const badObsStream = await app.request(
      `/api/public/obs-stream?overlay=${overlay.slug}&token=wrong-token`
    );
    expect(badObsStream.status).toBe(403);

    // Valid token -> 200 OK (and accessToken is never leaked in public response)
    const okObsState = await app.request(
      `/api/public/obs-state?overlay=${overlay.slug}&token=${overlay.accessToken}`
    );
    expect(okObsState.status).toBe(200);
    const obsData = await okObsState.json();
    expect(obsData.overlay.layoutPreset).toBe('scorebug_corner');
    expect(obsData.overlay.accessToken).toBeUndefined();

    // Update layout variation + transition + scene mapping + hide overlay
    const patchObs = await app.request(`/api/admin/obs-overlays/${overlay.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layoutPreset: 'standby_schedule',
        transitionPreset: 'zoom_pop',
        showBrandBug: true,
        sceneMappingJson: JSON.stringify({
          scorebug_corner: { obsSceneName: 'Kamera Utama' },
          standby_schedule: { obsSceneName: 'Scene Jeda' },
        }),
        isVisible: false,
      }),
    });
    expect(patchObs.status).toBe(200);
    const patchedOv = (await patchObs.json()).overlay;
    expect(patchedOv.isVisible).toBe(false);
    expect(patchedOv.transitionPreset).toBe('zoom_pop');
    expect(patchedOv.layoutPreset).toBe('standby_schedule');
    expect(patchedOv.sceneMappingJson).toContain('Kamera Utama');

    // Trigger Stinger Bumper & Download Lua Script
    const stingerRes = await app.request(`/api/admin/obs-overlays/${overlay.id}/stinger`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'REPLAY' }),
    });
    expect(stingerRes.status).toBe(200);

    const luaRes = await app.request(`/api/admin/obs-overlays/${overlay.id}/lua-script`, {
      headers: { Cookie: adminCookie },
    });
    expect(luaRes.status).toBe(200);
    const luaText = await luaRes.text();
    expect(luaText).toContain('obslua');
    expect(luaText).toContain(overlay.accessToken);

    // Token-gated Dock Control
    const dockRes = await app.request(
      `/api/public/obs-dock-control?overlay=${overlay.slug}&token=${overlay.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutPreset: 'lineup_roster', isVisible: true }),
      }
    );
    expect(dockRes.status).toBe(200);
    expect((await dockRes.json()).overlay.layoutPreset).toBe('lineup_roster');

    // Regenerate token invalidates old URL immediately
    const regenObs = await app.request(
      `/api/admin/obs-overlays/${overlay.id}/regenerate-token`,
      { method: 'POST', headers: { Cookie: adminCookie } }
    );
    expect(regenObs.status).toBe(200);
    const rotated = (await regenObs.json()).overlay;
    expect(rotated.accessToken).not.toBe(overlay.accessToken);

    const staleObsCheck = await app.request(
      `/api/public/obs-state?overlay=${overlay.slug}&token=${overlay.accessToken}`
    );
    expect(staleObsCheck.status).toBe(403);

    // 2. FIVB Form O-2 Optional Roster + Set Timestamps
    const catRes = await app.request('/api/admin/tournaments', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'O-2 Test Div', bestOf: 3 }),
    });
    const cat = (await catRes.json()).tournament;

    const teamRes = await app.request('/api/admin/teams', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournamentId: cat.id, name: 'Tim O2', school: 'Mojokerto' }),
    });
    const team = (await teamRes.json()).team;

    const addPlayer = await app.request(`/api/admin/teams/${team.id}/players`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jerseyNumber: 7, name: 'Bima', role: 'captain' }),
    });
    expect(addPlayer.status).toBe(201);
    const playersRes = await app.request(`/api/admin/teams/${team.id}/players`, {
      headers: { Cookie: adminCookie },
    });
    expect((await playersRes.json()).players.length).toBe(1);

    // 3. i18n dictionary parity
    const { DICTIONARY, translate } = await import('../shared/i18n');
    expect(Object.keys(DICTIONARY.id)).toEqual(Object.keys(DICTIONARY.en));
    expect(translate('en', 'nav_live')).toBe('Live Scores');

    // 4. Webhooks Anti-SSRF & HMAC signing
    const { isSafeWebhookUrl, signWebhookPayload } = await import('./services/webhook');
    expect(await isSafeWebhookUrl('http://127.0.0.1:8080/hook')).toBe(false);
    expect(await isSafeWebhookUrl('https://discord.com/api/webhooks/123/abc')).toBe(true);
    expect(signWebhookPayload('mysecret', '{"a":1}')).toMatch(/^sha256=[a-f0-9]{64}$/);

    const badHook = await app.request('/api/admin/webhooks', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Local SSRF', url: 'http://127.0.0.1/steal' }),
    });
    expect(badHook.status).toBe(400);

    const goodHook = await app.request('/api/admin/webhooks', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Discord Live',
        url: 'https://discord.com/api/webhooks/12345/abcdef',
        secret: 'topsecret',
        platform: 'discord',
      }),
    });
    expect(goodHook.status).toBe(201);
    expect((await goodHook.json()).webhook.hasSecret).toBe(true);
  });
});

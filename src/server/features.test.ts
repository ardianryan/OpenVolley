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
});

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { sanitizeHexColor, sanitizePlainText } from '../../shared/sanitize';
import { db } from '../db';
import { matches, siteSettings, teams, tournaments } from '../db/schema';
import { type AuthUser, requireAuth } from '../middleware/auth';
import { generateBracket, initializeDrawBracket } from '../services/bracket';
import { getFullOverview } from '../services/overview';
import {
  addExtraSet,
  addPoint,
  confirmCurrentSet,
  finishMatchManually,
  resetMatchScore,
  setServingTeam,
  startMatch,
  undoLastAction,
} from '../services/scoring';
import { broadcastEvent } from '../services/sse';
import { deleteUploadedImage, saveUploadedImage } from '../services/upload';

export const adminRoutes = new Hono<{ Variables: { user: AuthUser } }>();

adminRoutes.use('*', requireAuth(['admin', 'panitia']));

adminRoutes.get('/overview', async (c) => {
  const data = await getFullOverview(true);
  return c.json(data);
});

// TV Display PIN (Accessible to both Admin & Panitia)
adminRoutes.put('/tv-pin', async (c) => {
  const body = await c.req.json<{ tvPin?: string }>();
  const pin = (body.tvPin || '').trim();
  if (pin.length < 4 || pin.length > 12) {
    return c.json({ error: 'PIN TV harus terdiri dari 4 hingga 12 karakter' }, 400);
  }
  await db.update(siteSettings).set({ tvPin: pin }).where(eq(siteSettings.id, 'default'));
  return c.json({ ok: true, tvPin: pin });
});

// Site Settings & Branding (Admin only)
adminRoutes.put('/settings', requireAuth(['admin']), async (c) => {
  const body = await c.req.json<{
    eventName?: string;
    eventSubtitle?: string;
    eventMeta?: string;
    accentColor?: string;
    resetLogo?: boolean;
  }>();

  const updateData: Partial<typeof siteSettings.$inferInsert> = {};
  if (body.eventName !== undefined) {
    updateData.eventName = sanitizePlainText(body.eventName, 120);
  }
  if (body.eventSubtitle !== undefined) {
    updateData.eventSubtitle = sanitizePlainText(body.eventSubtitle, 160);
  }
  if (body.eventMeta !== undefined) {
    updateData.eventMeta = sanitizePlainText(body.eventMeta, 120);
  }
  if (body.accentColor !== undefined) {
    updateData.accentColor = sanitizeHexColor(body.accentColor, '#E09D17');
  }
  if (body.resetLogo) {
    updateData.logoUrl = '/brand/svc-crest-color.svg';
    updateData.coBrandLogoUrl = '/brand/aversa-standalone-color.svg';
    updateData.organizerLogoUrl = '/brand/logo_smansage.png';
  }

  await db.update(siteSettings).set(updateData).where(eq(siteSettings.id, 'default'));
  const updated = await db.query.siteSettings.findFirst();
  await broadcastEvent('settings_updated', updated);
  return c.json({ settings: updated });
});

adminRoutes.post('/settings/logo', requireAuth(['admin']), async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  const rawTarget = form.get('target');
  const target =
    rawTarget === 'coBrand'
      ? 'coBrandLogoUrl'
      : rawTarget === 'organizer'
        ? 'organizerLogoUrl'
        : 'logoUrl';

  if (!(file instanceof File)) {
    return c.json({ error: 'File gambar wajib diunggah' }, 400);
  }

  const url = await saveUploadedImage(file, 'logos');
  await db
    .update(siteSettings)
    .set({ [target]: url })
    .where(eq(siteSettings.id, 'default'));

  const updated = await db.query.siteSettings.findFirst();
  await broadcastEvent('settings_updated', updated);
  return c.json({ settings: updated });
});

adminRoutes.post('/settings/sponsors', requireAuth(['admin']), async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  const darkFile = form.get('darkFile');
  const name = sanitizePlainText(form.get('name') || 'Partner', 80) || 'Partner';
  const category = form.get('category') === 'media_partner' ? 'media_partner' : 'sponsor';
  const boxed = form.get('boxed') === 'true';

  if (!(file instanceof File)) {
    return c.json({ error: 'Logo sponsor utama wajib diunggah' }, 400);
  }

  const logoUrl = await saveUploadedImage(file, 'logos');
  const darkLogoUrl =
    darkFile instanceof File && darkFile.size > 0
      ? await saveUploadedImage(darkFile, 'logos')
      : undefined;

  const current = await db.query.siteSettings.findFirst();
  const list = (() => {
    try {
      return JSON.parse(current?.sponsorsJson || '[]') as Array<{
        id: string;
        name: string;
        logoUrl: string;
        darkLogoUrl?: string;
        category: 'sponsor' | 'media_partner';
        boxed?: boolean;
      }>;
    } catch {
      return [];
    }
  })();

  list.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    logoUrl,
    darkLogoUrl,
    category,
    boxed,
  });

  await db
    .update(siteSettings)
    .set({ sponsorsJson: JSON.stringify(list) })
    .where(eq(siteSettings.id, 'default'));

  const updated = await db.query.siteSettings.findFirst();
  await broadcastEvent('settings_updated', updated);
  return c.json({ settings: updated }, 201);
});

adminRoutes.put('/settings/sponsors/reorder', requireAuth(['admin']), async (c) => {
  const body = await c.req.json<{ orderedIds?: string[] }>();
  if (!Array.isArray(body.orderedIds)) {
    return c.json({ error: 'orderedIds wajib berupa array' }, 400);
  }

  const current = await db.query.siteSettings.findFirst();
  const list = (() => {
    try {
      return JSON.parse(current?.sponsorsJson || '[]') as Array<{
        id: string;
        name: string;
        logoUrl: string;
        darkLogoUrl?: string;
        category: 'sponsor' | 'media_partner';
        boxed?: boolean;
      }>;
    } catch {
      return [];
    }
  })();

  const byId = new Map(list.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const reordered: typeof list = [];

  for (const id of body.orderedIds) {
    const found = byId.get(id);
    if (found && !seen.has(id)) {
      reordered.push(found);
      seen.add(id);
    }
  }
  for (const item of list) {
    if (!seen.has(item.id)) {
      reordered.push(item);
      seen.add(item.id);
    }
  }

  await db
    .update(siteSettings)
    .set({ sponsorsJson: JSON.stringify(reordered) })
    .where(eq(siteSettings.id, 'default'));

  const updated = await db.query.siteSettings.findFirst();
  await broadcastEvent('settings_updated', updated);
  return c.json({ settings: updated });
});

adminRoutes.delete('/settings/sponsors/:id', requireAuth(['admin']), async (c) => {
  const sponsorId = c.req.param('id');
  const current = await db.query.siteSettings.findFirst();
  const list = (() => {
    try {
      return JSON.parse(current?.sponsorsJson || '[]') as Array<{
        id: string;
        name: string;
        logoUrl: string;
        darkLogoUrl?: string;
        category: 'sponsor' | 'media_partner';
      }>;
    } catch {
      return [];
    }
  })();

  const removed = list.find((s) => s.id === sponsorId);
  const nextList = list.filter((s) => s.id !== sponsorId);

  await db
    .update(siteSettings)
    .set({ sponsorsJson: JSON.stringify(nextList) })
    .where(eq(siteSettings.id, 'default'));

  if (removed) {
    await deleteUploadedImage(removed.logoUrl);
    if (removed.darkLogoUrl) {
      await deleteUploadedImage(removed.darkLogoUrl);
    }
  }

  const updated = await db.query.siteSettings.findFirst();
  await broadcastEvent('settings_updated', updated);
  return c.json({ settings: updated });
});

// Tournaments / Categories
adminRoutes.post('/tournaments', async (c) => {
  const body = await c.req.json<{
    name?: string;
    bestOf?: number;
    regularSetPoints?: number;
    decidingSetPoints?: number;
    useDeuce?: boolean;
    hasThirdPlace?: boolean;
  }>();

  const cleanCatName = sanitizePlainText(body.name, 80);
  if (!cleanCatName) {
    return c.json({ error: 'Nama kategori/turnamen wajib diisi' }, 400);
  }

  const slug =
    cleanCatName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') +
    '-' +
    Math.random().toString(36).slice(2, 6);

  const [created] = await db
    .insert(tournaments)
    .values({
      name: cleanCatName,
      slug,
      isEnabled: true,
      status: 'active',
      bestOf: body.bestOf === 5 ? 5 : body.bestOf === 1 ? 1 : 3,
      regularSetPoints: body.regularSetPoints || 25,
      decidingSetPoints: body.decidingSetPoints || 15,
      useDeuce: body.useDeuce ?? true,
      hasThirdPlace: body.hasThirdPlace ?? true,
      sortOrder: 10,
      createdAt: Date.now(),
    })
    .returning();

  await broadcastEvent('tournament_updated', created);
  return c.json({ tournament: created }, 201);
});

adminRoutes.patch('/tournaments/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Partial<typeof tournaments.$inferInsert>>();

  const updateData: Partial<typeof tournaments.$inferInsert> = {};
  if (body.name !== undefined) {
    const cleanName = sanitizePlainText(body.name, 80);
    if (cleanName) updateData.name = cleanName;
  }
  if (body.isEnabled !== undefined) updateData.isEnabled = Boolean(body.isEnabled);
  if (body.status !== undefined) {
    const validStatus = ['draft', 'active', 'finished'] as const;
    if ((validStatus as readonly string[]).includes(body.status)) {
      updateData.status = body.status;
    }
  }
  if (body.bestOf !== undefined) {
    updateData.bestOf = body.bestOf === 5 ? 5 : body.bestOf === 1 ? 1 : 3;
  }
  if (body.regularSetPoints !== undefined) updateData.regularSetPoints = Number(body.regularSetPoints);
  if (body.decidingSetPoints !== undefined) updateData.decidingSetPoints = Number(body.decidingSetPoints);
  if (body.useDeuce !== undefined) updateData.useDeuce = Boolean(body.useDeuce);
  if (body.hasThirdPlace !== undefined) updateData.hasThirdPlace = Boolean(body.hasThirdPlace);

  const [updated] = await db
    .update(tournaments)
    .set(updateData)
    .where(eq(tournaments.id, id))
    .returning();

  await broadcastEvent('tournament_updated', updated);
  return c.json({ tournament: updated });
});

adminRoutes.delete('/tournaments/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await db.delete(tournaments).where(eq(tournaments.id, id));
  await broadcastEvent('tournament_updated', { id, deleted: true });
  return c.json({ ok: true });
});

// Teams
adminRoutes.post('/teams', async (c) => {
  const body = await c.req.json<{
    tournamentId: number;
    name: string;
    shortCode?: string;
    school?: string;
    color?: string;
  }>();

  const name = sanitizePlainText(body.name, 80);
  if (!body.tournamentId || !name) {
    return c.json({ error: 'Turnamen dan nama tim wajib diisi' }, 400);
  }

  const shortCode = (
    sanitizePlainText(body.shortCode, 6) ||
    name
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 4)
  ).toUpperCase();

  const existingTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.tournamentId, body.tournamentId));

  const [created] = await db
    .insert(teams)
    .values({
      tournamentId: body.tournamentId,
      name,
      shortCode: shortCode || 'TIM',
      school: sanitizePlainText(body.school, 80),
      color: sanitizeHexColor(body.color, '#E09D17'),
      seed: existingTeams.length + 1,
    })
    .returning();

  await broadcastEvent('tournament_updated', { tournamentId: body.tournamentId });
  return c.json({ team: created }, 201);
});

adminRoutes.post('/teams/bulk', async (c) => {
  const body = await c.req.json<{ tournamentId: number; lines: string }>();
  if (!body.tournamentId || !body.lines?.trim()) {
    return c.json({ error: 'Daftar tim wajib diisi' }, 400);
  }

  const existingTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.tournamentId, body.tournamentId));
  let nextSeed = existingTeams.length + 1;

  const palette = ['#E09D17', '#3B82F6', '#EF4444', '#10B981', '#8B5CF6', '#EC4899'];
  const parsed = body.lines
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const inserted = [];
  for (const line of parsed) {
    const [rawNamePart, rawSchoolPart] = line.split('|');
    const namePart = sanitizePlainText(rawNamePart, 80);
    if (!namePart) continue;
    const schoolPart = sanitizePlainText(rawSchoolPart, 80);
    const shortCode =
      namePart
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 4)
        .toUpperCase() || 'TIM';

    const [created] = await db
      .insert(teams)
      .values({
        tournamentId: body.tournamentId,
        name: namePart,
        shortCode,
        school: schoolPart || '',
        color: palette[(nextSeed - 1) % palette.length],
        seed: nextSeed++,
      })
      .returning();
    inserted.push(created);
  }

  await broadcastEvent('tournament_updated', { tournamentId: body.tournamentId });
  return c.json({ teams: inserted }, 201);
});

adminRoutes.post('/teams/:id/logo', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'File logo wajib diunggah' }, 400);
  }

  const url = await saveUploadedImage(file, 'logos');
  const [updated] = await db
    .update(teams)
    .set({ logoUrl: url })
    .where(eq(teams.id, id))
    .returning();

  await broadcastEvent('tournament_updated', { tournamentId: updated.tournamentId });
  return c.json({ team: updated });
});

adminRoutes.patch('/teams/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{
    name?: string;
    shortCode?: string;
    school?: string;
  }>();

  const updateData: Partial<typeof teams.$inferInsert> = {};
  if (body.name !== undefined) {
    const trimmed = sanitizePlainText(body.name, 80);
    if (trimmed) {
      updateData.name = trimmed;
      if (!body.shortCode) {
        updateData.shortCode =
          trimmed
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, 4)
            .toUpperCase() || 'TIM';
      }
    }
  }
  if (body.shortCode !== undefined) {
    updateData.shortCode = sanitizePlainText(body.shortCode, 6).toUpperCase() || 'TIM';
  }
  if (body.school !== undefined) {
    updateData.school = sanitizePlainText(body.school, 80);
  }

  const [updated] = await db
    .update(teams)
    .set(updateData)
    .where(eq(teams.id, id))
    .returning();

  await broadcastEvent('tournament_updated', { tournamentId: updated.tournamentId });
  return c.json({ team: updated });
});

adminRoutes.delete('/teams/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await db.delete(teams).where(eq(teams.id, id));
  await broadcastEvent('tournament_updated', { teamDeleted: id });
  return c.json({ ok: true });
});

// Bracket Generation & Drawing Slots
adminRoutes.post('/tournaments/:id/init-draw', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ slotCount?: 4 | 8 | 16 }>().catch(() => ({ slotCount: 16 as const }));
  const count = body.slotCount === 4 || body.slotCount === 8 ? body.slotCount : 16;
  try {
    const generated = await initializeDrawBracket(id, count);
    await broadcastEvent('bracket_updated', { tournamentId: id });
    return c.json({ matches: generated });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminRoutes.post('/tournaments/:id/generate-bracket', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ shuffle?: boolean }>().catch(() => ({ shuffle: false }));
  try {
    const generated = await generateBracket(id, Boolean(body.shuffle));
    await broadcastEvent('bracket_updated', { tournamentId: id });
    return c.json({ matches: generated });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Live Scoring & Match Management
adminRoutes.post('/matches/:id/score', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{
    action:
      | 'start'
      | 'point'
      | 'undo'
      | 'serve'
      | 'finish'
      | 'reset'
      | 'extra_set'
      | 'confirm_set_next'
      | 'confirm_match_finish';
    team?: 'A' | 'B';
    delta?: 1 | -1;
    rules?: {
      bestOf?: number;
      regularSetPoints?: number;
      decidingSetPoints?: number;
      useDeuce?: boolean;
    };
  }>();

  try {
    let result;
    switch (body.action) {
      case 'start':
        result = await startMatch(id, body.rules);
        break;
      case 'confirm_set_next':
        result = await confirmCurrentSet(id, 'next_set');
        break;
      case 'confirm_match_finish':
        result = await confirmCurrentSet(id, 'finish_match');
        break;
      case 'extra_set':
        result = await addExtraSet(id);
        break;
      case 'point':
        if (!body.team || (body.delta !== 1 && body.delta !== -1)) {
          return c.json({ error: 'Parameter team dan delta wajib valid' }, 400);
        }
        result = await addPoint(id, body.team, body.delta);
        break;
      case 'undo':
        result = await undoLastAction(id);
        break;
      case 'serve':
        if (!body.team) return c.json({ error: 'Parameter team wajib diisi' }, 400);
        result = await setServingTeam(id, body.team);
        break;
      case 'finish':
        if (!body.team) return c.json({ error: 'Tim pemenang wajib dipilih' }, 400);
        result = await finishMatchManually(id, body.team);
        break;
      case 'reset':
        result = await resetMatchScore(id);
        break;
      default:
        return c.json({ error: 'Aksi tidak dikenal' }, 400);
    }

    await broadcastEvent('match_updated', result);
    if (
      result?.status === 'finished' ||
      body.action === 'reset' ||
      body.action === 'extra_set' ||
      body.action === 'confirm_match_finish'
    ) {
      await broadcastEvent('bracket_updated', { tournamentId: result?.tournamentId });
    }
    return c.json({ match: result });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminRoutes.patch('/matches/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ courtName?: string; scheduledAt?: string }>();

  const updateData: Partial<typeof matches.$inferInsert> = {};
  if (body.courtName !== undefined) {
    updateData.courtName = sanitizePlainText(body.courtName, 40) || 'Court 1';
  }
  if (body.scheduledAt !== undefined) {
    updateData.scheduledAt = sanitizePlainText(body.scheduledAt, 60);
  }

  const [updated] = await db
    .update(matches)
    .set(updateData)
    .where(eq(matches.id, id))
    .returning();

  await broadcastEvent('match_updated', updated);
  return c.json({ match: updated });
});

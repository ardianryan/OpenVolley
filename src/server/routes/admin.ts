import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  inferTeamLevelFromName,
  sanitizeMasterLevel,
  type MasterTeamLevel,
} from '../../shared/fivb-draw';
import { hasAnyPermission } from '../../shared/rbac';
import { sanitizeHexColor, sanitizePlainText } from '../../shared/sanitize';
import { db } from '../db';
import {
  masterCourts,
  masterTeams,
  matchReports,
  matchSets,
  matches,
  obsOverlays,
  siteSettings,
  teamPlayers,
  teams,
  tournaments,
  tvScreens,
  webhooks,
} from '../db/schema';
import {
  type AuthUser,
  requireAuth,
  requirePermission,
} from '../middleware/auth';
import { createSqliteS3Backup, listS3Backups } from '../services/backup';
import {
  advancePoolsToKnockout,
  generateBracket,
  generatePoolStageBracket,
  initializeDrawBracket,
} from '../services/bracket';
import { getFullOverview } from '../services/overview';
import {
  addExtraSet,
  addPoint,
  adjustSetCounter,
  confirmCurrentSet,
  finishMatchManually,
  getMatchWithSets,
  resetMatchScore,
  setServingTeam,
  startMatch,
  undoLastAction,
} from '../services/scoring';
import { broadcastEvent } from '../services/sse';
import {
  deleteUploadedImage,
  deleteUploadedReportAssets,
  saveUploadedImage,
} from '../services/upload';
import { isSafeWebhookUrl, sendTestWebhook } from '../services/webhook';

export const adminRoutes = new Hono<{ Variables: { user: AuthUser } }>();

adminRoutes.use('*', requireAuth());

// Granular RBAC endpoint guards (Security Audit Hardening)
adminRoutes.use(
  '/overview',
  requirePermission(
    'overview',
    'contingents',
    'schedule',
    'tournaments',
    'operator',
    'tv_screens',
    'documents',
    'branding',
    'integrations'
  )
);
adminRoutes.use('/tv-pin', requirePermission('branding', 'tv_screens'));
adminRoutes.use('/settings/docs', requirePermission('documents', 'branding'));
adminRoutes.use('/settings/doc-cover', requirePermission('documents', 'branding'));
adminRoutes.use('/settings', requirePermission('branding'));
adminRoutes.use('/settings/logo', requirePermission('branding'));
adminRoutes.use('/settings/sponsors', requirePermission('branding'));
adminRoutes.use('/settings/sponsors/*', requirePermission('branding'));
adminRoutes.use('/master-teams', requirePermission('contingents', 'tournaments'));
adminRoutes.use('/master-teams/*', requirePermission('contingents', 'tournaments'));
adminRoutes.use('/tournaments', requirePermission('tournaments'));
adminRoutes.use('/tournaments/*', requirePermission('tournaments'));
adminRoutes.use('/teams', requirePermission('tournaments'));
adminRoutes.use('/teams/*', requirePermission('tournaments'));
adminRoutes.use('/master-courts', requirePermission('schedule', 'tournaments'));
adminRoutes.use('/master-courts/*', requirePermission('schedule', 'tournaments'));
adminRoutes.use(
  '/matches/bulk-schedule-assign',
  requirePermission('schedule', 'tournaments')
);
adminRoutes.use(
  '/matches/bulk-schedule-clear',
  requirePermission('schedule', 'tournaments')
);
adminRoutes.use('/matches/:id/score', requirePermission('operator'));
adminRoutes.use('/matches/:id', requirePermission('schedule', 'tournaments', 'operator'));
adminRoutes.use('/tv-screens', requirePermission('tv_screens'));
adminRoutes.use('/tv-screens/*', requirePermission('tv_screens'));
adminRoutes.use('/obs-overlays', requirePermission('obs_overlays'));
adminRoutes.use('/obs-overlays/*', requirePermission('obs_overlays'));
adminRoutes.use('/players/*', requirePermission('tournaments', 'documents', 'contingents'));
adminRoutes.use('/teams/:id/players', requirePermission('tournaments', 'documents', 'contingents'));
adminRoutes.use('/webhooks', requirePermission('integrations'));
adminRoutes.use('/webhooks/*', requirePermission('integrations'));
adminRoutes.use('/backups', requirePermission('integrations'));
adminRoutes.use('/backups/*', requirePermission('integrations'));

function sanitizeDocSettingsJson(
  rawInput: unknown,
  existingJson = '{}'
): string {
  let prev: Record<string, string> = {};
  try {
    prev = JSON.parse(existingJson || '{}') as Record<string, string>;
  } catch {
    prev = {};
  }

  let incoming: Record<string, unknown> = {};
  if (typeof rawInput === 'string') {
    try {
      incoming = JSON.parse(rawInput) as Record<string, unknown>;
    } catch {
      incoming = {};
    }
  } else if (rawInput && typeof rawInput === 'object') {
    incoming = rawInput as Record<string, unknown>;
  }

  const merged: Record<string, string> = { ...prev };
  const textFields: Array<[string, number]> = [
    ['bulletinNumber', 60],
    ['bulletinEdition', 120],
    ['venueName', 120],
    ['publishedDate', 80],
    ['referee1Default', 80],
    ['referee2Default', 80],
    ['committeeChair', 80],
  ];

  for (const [key, maxLen] of textFields) {
    if (incoming[key] !== undefined) {
      merged[key] = sanitizePlainText(incoming[key], maxLen);
    }
  }

  if (typeof incoming.coverImageUrl === 'string') {
    const cleanUrl = incoming.coverImageUrl.trim();
    if (
      cleanUrl === '' ||
      cleanUrl.startsWith('/uploads/') ||
      cleanUrl.startsWith('/brand/') ||
      cleanUrl.startsWith('https://') ||
      cleanUrl.startsWith('http://')
    ) {
      merged.coverImageUrl = cleanUrl;
    }
  }

  return JSON.stringify(merged);
}

function sanitizeJerseyColorsJson(rawInput: unknown): string {
  let arr: unknown[] = [];
  if (typeof rawInput === 'string') {
    try {
      const parsed = JSON.parse(rawInput);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
  } else if (Array.isArray(rawInput)) {
    arr = rawInput;
  }

  const cleaned = arr
    .slice(0, 4)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as { label?: unknown; hex?: unknown };
      const label = sanitizePlainText(obj.label, 30);
      if (!label) return null;
      const hex = sanitizeHexColor(obj.hex, '#1E293B');
      return { label, hex };
    })
    .filter((x): x is { label: string; hex: string } => Boolean(x));

  return JSON.stringify(cleaned);
}

function sanitizePoolCode(raw: unknown): string | null {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const cleaned = sanitizePlainText(raw, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned || null;
}

adminRoutes.get('/overview', async (c) => {
  const user = c.get('user');
  const data = await getFullOverview(true);
  const canSeeTvPin = hasAnyPermission(user.permissions, user.role, [
    'branding',
    'tv_screens',
  ]);
  if (!canSeeTvPin && data.settings && 'tvPin' in data.settings) {
    const { tvPin: _hiddenPin, ...safeSettings } = data.settings;
    return c.json({ ...data, settings: safeSettings });
  }
  return c.json(data);
});

// TV Display PIN
adminRoutes.put('/tv-pin', async (c) => {
  const body = await c.req.json<{ tvPin?: string }>();
  const pin = (body.tvPin || '').trim();
  if (pin.length < 4 || pin.length > 12) {
    return c.json({ error: 'PIN TV harus terdiri dari 4 hingga 12 karakter' }, 400);
  }
  await db.update(siteSettings).set({ tvPin: pin }).where(eq(siteSettings.id, 'default'));
  return c.json({ ok: true, tvPin: pin });
});

// Site Settings & Branding
adminRoutes.put('/settings', async (c) => {
  const body = await c.req.json<{
    eventName?: string;
    eventSubtitle?: string;
    eventMeta?: string;
    accentColor?: string;
    seoDescription?: string;
    publicDocsEnabled?: boolean;
    publicTvEnabled?: boolean;
    docSettingsJson?: unknown;
    resetLogo?: boolean;
    resetSocialImage?: boolean;
    resetDocCover?: boolean;
  }>();

  const current = await db.query.siteSettings.findFirst();
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
  if (body.seoDescription !== undefined) {
    updateData.seoDescription = sanitizePlainText(body.seoDescription, 260);
  }
  if (body.publicDocsEnabled !== undefined) {
    updateData.publicDocsEnabled = Boolean(body.publicDocsEnabled);
  }
  if (body.publicTvEnabled !== undefined) {
    updateData.publicTvEnabled = Boolean(body.publicTvEnabled);
  }
  if (body.docSettingsJson !== undefined) {
    updateData.docSettingsJson = sanitizeDocSettingsJson(
      body.docSettingsJson,
      current?.docSettingsJson
    );
  }
  if (body.resetLogo) {
    updateData.logoUrl = '/brand/svc-crest-color.svg';
    updateData.coBrandLogoUrl = '/brand/aversa-standalone-color.svg';
    updateData.organizerLogoUrl = '/brand/logo_smansage.png';
  }
  if (body.resetSocialImage) {
    if (current?.socialImageUrl) {
      await deleteUploadedImage(current.socialImageUrl);
    }
    updateData.socialImageUrl = '';
  }
  if (body.resetDocCover) {
    try {
      const parsed = JSON.parse(current?.docSettingsJson || '{}') as {
        coverImageUrl?: string;
      };
      if (parsed.coverImageUrl) {
        await deleteUploadedImage(parsed.coverImageUrl);
      }
      parsed.coverImageUrl = '';
      updateData.docSettingsJson = JSON.stringify(parsed);
    } catch {
      updateData.docSettingsJson = '{}';
    }
  }

  await db.update(siteSettings).set(updateData).where(eq(siteSettings.id, 'default'));
  const updated = await db.query.siteSettings.findFirst();
  await broadcastEvent('settings_updated', updated);
  return c.json({ settings: updated });
});

// Official Documents Settings (Admin & Panitia can edit Bulletin/Referee metadata; Admin can toggle publicDocsEnabled)
adminRoutes.put('/settings/docs', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    docSettings?: unknown;
    publicDocsEnabled?: boolean;
    resetDocCover?: boolean;
  }>();

  const current = await db.query.siteSettings.findFirst();
  const updateData: Partial<typeof siteSettings.$inferInsert> = {};

  if (body.docSettings !== undefined) {
    updateData.docSettingsJson = sanitizeDocSettingsJson(
      body.docSettings,
      current?.docSettingsJson
    );
  }

  if (body.resetDocCover) {
    try {
      const parsed = JSON.parse(
        updateData.docSettingsJson || current?.docSettingsJson || '{}'
      ) as Record<string, string>;
      if (parsed.coverImageUrl) {
        await deleteUploadedImage(parsed.coverImageUrl);
      }
      parsed.coverImageUrl = '';
      updateData.docSettingsJson = JSON.stringify(parsed);
    } catch {
      updateData.docSettingsJson = '{}';
    }
  }

  if (
    body.publicDocsEnabled !== undefined &&
    (user.role === 'admin' || user.permissions.includes('branding'))
  ) {
    updateData.publicDocsEnabled = Boolean(body.publicDocsEnabled);
  }

  await db.update(siteSettings).set(updateData).where(eq(siteSettings.id, 'default'));
  const updated = await db.query.siteSettings.findFirst();
  await broadcastEvent('settings_updated', updated);
  return c.json({ settings: updated });
});

adminRoutes.post('/settings/doc-cover', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'File sampul wajib diunggah' }, 400);
  }

  const url = await saveUploadedImage(file, 'logos');
  const current = await db.query.siteSettings.findFirst();
  const nextDocJson = sanitizeDocSettingsJson(
    { coverImageUrl: url },
    current?.docSettingsJson
  );

  await db
    .update(siteSettings)
    .set({ docSettingsJson: nextDocJson })
    .where(eq(siteSettings.id, 'default'));

  const updated = await db.query.siteSettings.findFirst();
  await broadcastEvent('settings_updated', updated);
  return c.json({ settings: updated });
});

adminRoutes.post('/settings/logo', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  const rawTarget = form.get('target');

  if (!(file instanceof File)) {
    return c.json({ error: 'File gambar wajib diunggah' }, 400);
  }

  const url = await saveUploadedImage(file, 'logos');

  if (rawTarget === 'docCover') {
    const current = await db.query.siteSettings.findFirst();
    const nextDocJson = sanitizeDocSettingsJson(
      { coverImageUrl: url },
      current?.docSettingsJson
    );
    await db
      .update(siteSettings)
      .set({ docSettingsJson: nextDocJson })
      .where(eq(siteSettings.id, 'default'));
  } else {
    const target =
      rawTarget === 'coBrand'
        ? 'coBrandLogoUrl'
        : rawTarget === 'organizer'
          ? 'organizerLogoUrl'
          : rawTarget === 'social'
            ? 'socialImageUrl'
            : 'logoUrl';

    await db
      .update(siteSettings)
      .set({ [target]: url })
      .where(eq(siteSettings.id, 'default'));
  }

  const updated = await db.query.siteSettings.findFirst();
  await broadcastEvent('settings_updated', updated);
  return c.json({ settings: updated });
});

adminRoutes.post('/settings/sponsors', async (c) => {
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

adminRoutes.put('/settings/sponsors/reorder', async (c) => {
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

adminRoutes.delete('/settings/sponsors/:id', async (c) => {
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
    format?: 'knockout' | 'pool_knockout';
    poolCount?: number;
    advancePerPool?: number;
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

  const format = body.format === 'pool_knockout' ? 'pool_knockout' : 'knockout';
  const poolCount = Math.max(2, Math.min(8, Number(body.poolCount) || 4));
  const advancePerPool = body.advancePerPool === 1 ? 1 : 2;

  const [created] = await db
    .insert(tournaments)
    .values({
      name: cleanCatName,
      slug,
      isEnabled: true,
      status: 'active',
      format,
      poolCount,
      advancePerPool,
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
  if (body.format !== undefined) {
    updateData.format = body.format === 'pool_knockout' ? 'pool_knockout' : 'knockout';
  }
  if (body.poolCount !== undefined) {
    updateData.poolCount = Math.max(2, Math.min(8, Number(body.poolCount) || 4));
  }
  if (body.advancePerPool !== undefined) {
    updateData.advancePerPool = Number(body.advancePerPool) === 1 ? 1 : 2;
  }
  if (body.bestOf !== undefined) {
    updateData.bestOf = body.bestOf === 5 ? 5 : body.bestOf === 1 ? 1 : 3;
  }
  if (body.regularSetPoints !== undefined) updateData.regularSetPoints = Number(body.regularSetPoints);
  if (body.decidingSetPoints !== undefined) updateData.decidingSetPoints = Number(body.decidingSetPoints);
  if (body.useDeuce !== undefined) updateData.useDeuce = Boolean(body.useDeuce);
  if (body.hasThirdPlace !== undefined) {
    const wantsThird = Boolean(body.hasThirdPlace);
    updateData.hasThirdPlace = wantsThird;

    // Handle skip or restore 3rd place match if bracket already exists
    if (!wantsThird) {
      const existingThird = await db.query.matches.findFirst({
        where: and(eq(matches.tournamentId, id), eq(matches.bracketType, 'third_place')),
      });
      if (existingThird && existingThird.status !== 'finished') {
        await db
          .update(matches)
          .set({ loserNextMatchId: null, loserNextMatchSlot: null })
          .where(eq(matches.loserNextMatchId, existingThird.id));
        await db.delete(matchSets).where(eq(matchSets.matchId, existingThird.id));
        await db.delete(matches).where(eq(matches.id, existingThird.id));
      }
    } else {
      const existingThird = await db.query.matches.findFirst({
        where: and(eq(matches.tournamentId, id), eq(matches.bracketType, 'third_place')),
      });
      if (!existingThird) {
        const allMain = await db
          .select()
          .from(matches)
          .where(and(eq(matches.tournamentId, id), eq(matches.bracketType, 'main')));
        if (allMain.length >= 3) {
          const maxRound = Math.max(...allMain.map((m) => m.round));
          const semiMatches = allMain.filter((m) => m.round === maxRound - 1);
          if (semiMatches.length === 2) {
            const [thirdMatch] = await db
              .insert(matches)
              .values({
                tournamentId: id,
                round: maxRound,
                matchIndex: 1,
                bracketType: 'third_place',
                status: 'scheduled',
                courtName: 'Court 1',
              })
              .returning({ id: matches.id });
            if (thirdMatch) {
              await db
                .update(matches)
                .set({ loserNextMatchId: thirdMatch.id, loserNextMatchSlot: 'A' })
                .where(eq(matches.id, semiMatches[0]!.id));
              await db
                .update(matches)
                .set({ loserNextMatchId: thirdMatch.id, loserNextMatchSlot: 'B' })
                .where(eq(matches.id, semiMatches[1]!.id));
            }
          }
        }
      }
    }
  }

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
  const existing = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Kategori pertandingan tidak ditemukan' }, 404);
  }

  // Collect uploaded team logos & gallery report media before SQLite ON DELETE CASCADE wipes rows
  const catTeams = await db
    .select({ logoUrl: teams.logoUrl })
    .from(teams)
    .where(eq(teams.tournamentId, id));

  const catMatches = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.tournamentId, id));
  const matchIds = catMatches.map((m) => m.id);

  const catReports =
    matchIds.length > 0
      ? await db
          .select({ imagePath: matchReports.imagePath, mediaJson: matchReports.mediaJson })
          .from(matchReports)
          .where(inArray(matchReports.matchId, matchIds))
      : [];

  // Delete tournament (cascades teams, matches, match_sets, and match_reports)
  await db.delete(tournaments).where(eq(tournaments.id, id));

  // Best-effort cleanup of S3 / local disk assets (preserving shared Master Team logos!)
  for (const t of catTeams) {
    if (t.logoUrl) await safeDeleteTeamLogoIfUnreferenced(t.logoUrl);
  }
  for (const rep of catReports) {
    await deleteUploadedReportAssets(rep.imagePath, rep.mediaJson);
  }

  await broadcastEvent('tournament_updated', { id, deleted: true });
  return c.json({
    ok: true,
    deletedTeams: catTeams.length,
    deletedMatches: catMatches.length,
    deletedReports: catReports.length,
  });
});

async function safeDeleteTeamLogoIfUnreferenced(logoUrl: string | null | undefined) {
  if (!logoUrl) return;
  const stillInMaster = await db.query.masterTeams.findFirst({
    where: eq(masterTeams.logoUrl, logoUrl),
  });
  if (stillInMaster) return;
  const stillInTeams = await db.query.teams.findFirst({
    where: eq(teams.logoUrl, logoUrl),
  });
  if (stillInTeams) return;
  await deleteUploadedImage(logoUrl);
}

function deriveShortCode(name: string, rawShortCode?: string): string {
  const cleanShort = sanitizePlainText(rawShortCode, 6).toUpperCase();
  if (cleanShort) return cleanShort;
  return (
    name
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 4)
      .toUpperCase() || 'TIM'
  );
}

function formatSquadEntryName(baseName: string, squadLabel?: string): string {
  const sq = sanitizePlainText(squadLabel, 8).toUpperCase();
  if (!sq) return baseName;
  return `${baseName} (Tim ${sq})`;
}

function formatSquadShortCode(baseShortCode: string, squadLabel?: string): string {
  const sq = sanitizePlainText(squadLabel, 3).toUpperCase();
  if (!sq) return baseShortCode;
  return `${baseShortCode.slice(0, Math.max(1, 6 - sq.length))}${sq}`;
}

// =========================================================================
// MASTER TEAMS / CONTINGENTS REGISTRY (FIVB VIS Shared Federation/Club DB)
// =========================================================================
adminRoutes.post('/master-teams', async (c) => {
  const body = await c.req.json<{
    name: string;
    shortCode?: string;
    school?: string;
    level?: string;
    color?: string;
    defaultCoachName?: string;
    defaultManagerName?: string;
    defaultJerseyColors?: unknown;
  }>();

  const name = sanitizePlainText(body.name, 80);
  if (!name) {
    return c.json({ error: 'Nama kontingen / sekolah wajib diisi' }, 400);
  }
  const school = sanitizePlainText(body.school, 80);
  const dupExisting = await db.select().from(masterTeams);
  const exactDup = dupExisting.find(
    (mt) =>
      mt.name.trim().toLowerCase() === name.toLowerCase() &&
      (mt.school || '').trim().toLowerCase() === school.toLowerCase()
  );
  if (exactDup) {
    return c.json(
      { error: 'Kontingen / sekolah ini sudah terdaftar di Master Tim', masterTeam: exactDup },
      409
    );
  }

  const level: MasterTeamLevel = body.level
    ? sanitizeMasterLevel(body.level)
    : inferTeamLevelFromName(name, school);

  const [created] = await db
    .insert(masterTeams)
    .values({
      name,
      shortCode: deriveShortCode(name, body.shortCode),
      school,
      level,
      color: sanitizeHexColor(body.color, '#E09D17'),
      defaultCoachName: sanitizePlainText(body.defaultCoachName, 80),
      defaultManagerName: sanitizePlainText(body.defaultManagerName, 80),
      defaultJerseyColors: sanitizeJerseyColorsJson(body.defaultJerseyColors),
      createdAt: Date.now(),
    })
    .returning();

  await broadcastEvent('master_teams_updated', { created });
  return c.json({ masterTeam: created }, 201);
});

adminRoutes.post('/master-teams/bulk', async (c) => {
  const body = await c.req.json<{ lines: string; defaultLevel?: string }>();
  if (!body.lines?.trim()) {
    return c.json({ error: 'Daftar kontingen / sekolah wajib diisi' }, 400);
  }

  const existingAll = await db.select().from(masterTeams);
  const existingKeys = new Set(
    existingAll.map(
      (mt) => `${mt.name.trim().toLowerCase()}||${(mt.school || '').trim().toLowerCase()}`
    )
  );

  const palette = ['#E09D17', '#3B82F6', '#EF4444', '#10B981', '#8B5CF6', '#EC4899'];
  const rawLines = body.lines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const inserted = [];
  let skipped = 0;
  let colorCursor = existingAll.length;
  const now = Date.now();

  for (const line of rawLines) {
    // Support Google Sheets / Excel Tab-separated (`No \t Nama \t Kab/Kota`) OR Pipe-separated (`Nama | Kab/Kota`)
    const cols = (line.includes('\t') ? line.split('\t') : line.split('|')).map((s) =>
      s.trim()
    );
    if (cols.length === 0) continue;

    // Auto-strip leading row number column from Excel/Sheets (e.g. "1 \t SMPN 2 Kota Mojokerto \t Kota Mojokerto")
    let offset = 0;
    if (cols.length >= 2 && /^\d+$/.test(cols[0]!)) {
      offset = 1;
    }

    const rawName = cols[offset] || '';
    // Skip spreadsheet header rows
    if (
      !rawName ||
      /^(no|nama\s+(sekolah|tim|kontingen))$/i.test(rawName)
    ) {
      continue;
    }

    const namePart = sanitizePlainText(rawName, 80);
    if (!namePart) continue;

    const schoolPart = sanitizePlainText(cols[offset + 1] || '', 80);
    const rawLevelCol = cols[offset + 2] || body.defaultLevel || '';
    const rawCodeCol = cols[offset + 3] || '';

    const dedupKey = `${namePart.toLowerCase()}||${schoolPart.toLowerCase()}`;
    if (existingKeys.has(dedupKey)) {
      skipped++;
      continue;
    }
    existingKeys.add(dedupKey);

    const level: MasterTeamLevel = rawLevelCol
      ? sanitizeMasterLevel(rawLevelCol)
      : inferTeamLevelFromName(namePart, schoolPart);

    const [created] = await db
      .insert(masterTeams)
      .values({
        name: namePart,
        shortCode: deriveShortCode(namePart, rawCodeCol),
        school: schoolPart,
        level,
        color: palette[colorCursor++ % palette.length]!,
        createdAt: now,
      })
      .returning();

    inserted.push(created);
  }

  await broadcastEvent('master_teams_updated', { count: inserted.length });
  return c.json({ masterTeams: inserted, insertedCount: inserted.length, skippedCount: skipped }, 201);
});

adminRoutes.patch('/master-teams/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const prevMaster = await db.query.masterTeams.findFirst({
    where: eq(masterTeams.id, id),
  });
  if (!prevMaster) {
    return c.json({ error: 'Data Master Tim tidak ditemukan' }, 404);
  }

  const body = await c.req.json<{
    name?: string;
    shortCode?: string;
    school?: string;
    level?: string;
    color?: string;
    defaultCoachName?: string;
    defaultManagerName?: string;
    defaultJerseyColors?: unknown;
  }>();

  const patch: Partial<typeof masterTeams.$inferInsert> = {};
  if (body.name !== undefined) {
    const cleanName = sanitizePlainText(body.name, 80);
    if (cleanName) {
      patch.name = cleanName;
      if (body.shortCode === undefined) {
        patch.shortCode = deriveShortCode(cleanName);
      }
    }
  }
  if (body.shortCode !== undefined) {
    patch.shortCode = deriveShortCode(patch.name || prevMaster.name, body.shortCode);
  }
  if (body.school !== undefined) {
    patch.school = sanitizePlainText(body.school, 80);
  }
  if (body.level !== undefined) {
    patch.level = sanitizeMasterLevel(body.level);
  }
  if (body.color !== undefined) {
    patch.color = sanitizeHexColor(body.color, prevMaster.color);
  }
  if (body.defaultCoachName !== undefined) {
    patch.defaultCoachName = sanitizePlainText(body.defaultCoachName, 80);
  }
  if (body.defaultManagerName !== undefined) {
    patch.defaultManagerName = sanitizePlainText(body.defaultManagerName, 80);
  }
  if (body.defaultJerseyColors !== undefined) {
    patch.defaultJerseyColors = sanitizeJerseyColorsJson(body.defaultJerseyColors);
  }

  const [updatedMaster] = await db
    .update(masterTeams)
    .set(patch)
    .where(eq(masterTeams.id, id))
    .returning();

  // Propagate shared identity & un-overridden defaults to all category team entries!
  const linkedEntries = await db
    .select()
    .from(teams)
    .where(eq(teams.masterTeamId, id));

  for (const entry of linkedEntries) {
    const entryPatch: Partial<typeof teams.$inferInsert> = {
      name: formatSquadEntryName(updatedMaster!.name, entry.squadLabel),
      shortCode: formatSquadShortCode(updatedMaster!.shortCode, entry.squadLabel),
      school: updatedMaster!.school,
      color: updatedMaster!.color,
    };

    // Inherit default staff/jerseys only if the category entry had not customized them
    if (
      body.defaultCoachName !== undefined &&
      (!entry.coachName || entry.coachName === prevMaster.defaultCoachName)
    ) {
      entryPatch.coachName = updatedMaster!.defaultCoachName;
    }
    if (
      body.defaultManagerName !== undefined &&
      (!entry.managerName || entry.managerName === prevMaster.defaultManagerName)
    ) {
      entryPatch.managerName = updatedMaster!.defaultManagerName;
    }
    if (
      body.defaultJerseyColors !== undefined &&
      (!entry.jerseyColors ||
        entry.jerseyColors === '[]' ||
        entry.jerseyColors === prevMaster.defaultJerseyColors)
    ) {
      entryPatch.jerseyColors = updatedMaster!.defaultJerseyColors;
    }

    await db.update(teams).set(entryPatch).where(eq(teams.id, entry.id));
  }

  await broadcastEvent('master_teams_updated', { masterTeam: updatedMaster });
  if (linkedEntries.length > 0) {
    await broadcastEvent('tournament_updated', { masterTeamSynced: id });
  }
  return c.json({ masterTeam: updatedMaster });
});

adminRoutes.post('/master-teams/:id/logo', async (c) => {
  const id = Number(c.req.param('id'));
  const prevMaster = await db.query.masterTeams.findFirst({
    where: eq(masterTeams.id, id),
  });
  if (!prevMaster) {
    return c.json({ error: 'Data Master Tim tidak ditemukan' }, 404);
  }

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'File logo wajib diunggah' }, 400);
  }

  const url = await saveUploadedImage(file, 'logos');
  const [updatedMaster] = await db
    .update(masterTeams)
    .set({ logoUrl: url })
    .where(eq(masterTeams.id, id))
    .returning();

  // Propagate new logo automatically to all linked category entries!
  await db
    .update(teams)
    .set({ logoUrl: url })
    .where(eq(teams.masterTeamId, id));

  if (prevMaster.logoUrl && prevMaster.logoUrl !== url) {
    await safeDeleteTeamLogoIfUnreferenced(prevMaster.logoUrl);
  }

  await broadcastEvent('master_teams_updated', { masterTeam: updatedMaster });
  await broadcastEvent('tournament_updated', { masterTeamSynced: id });
  return c.json({ masterTeam: updatedMaster });
});

adminRoutes.delete('/master-teams/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await db.query.masterTeams.findFirst({
    where: eq(masterTeams.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Data Master Tim tidak ditemukan' }, 404);
  }

  await db.delete(masterTeams).where(eq(masterTeams.id, id));
  await safeDeleteTeamLogoIfUnreferenced(existing.logoUrl);
  await broadcastEvent('master_teams_updated', { deletedId: id });
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
    poolName?: string | null;
    coachName?: string;
    managerName?: string;
    jerseyColors?: unknown;
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
      poolName: sanitizePoolCode(body.poolName),
      coachName: sanitizePlainText(body.coachName, 80),
      managerName: sanitizePlainText(body.managerName, 80),
      jerseyColors: sanitizeJerseyColorsJson(body.jerseyColors),
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
    color?: string;
    poolName?: string | null;
    isSeeded?: boolean;
    coachName?: string;
    managerName?: string;
    jerseyColors?: unknown;
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
  if (body.color !== undefined) {
    updateData.color = sanitizeHexColor(body.color, '#E09D17');
  }
  if (body.poolName !== undefined) {
    updateData.poolName = sanitizePoolCode(body.poolName);
  }
  if (body.isSeeded !== undefined) {
    updateData.isSeeded = Boolean(body.isSeeded);
  }
  if (body.coachName !== undefined) {
    updateData.coachName = sanitizePlainText(body.coachName, 80);
  }
  if (body.managerName !== undefined) {
    updateData.managerName = sanitizePlainText(body.managerName, 80);
  }
  if (body.jerseyColors !== undefined) {
    updateData.jerseyColors = sanitizeJerseyColorsJson(body.jerseyColors);
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
  const prev = await db.query.teams.findFirst({ where: eq(teams.id, id) });
  await db.delete(teams).where(eq(teams.id, id));
  if (prev?.logoUrl) {
    await safeDeleteTeamLogoIfUnreferenced(prev.logoUrl);
  }
  await broadcastEvent('tournament_updated', { teamDeleted: id });
  return c.json({ ok: true });
});

// =========================================================================
// TECHNICAL MEETING (TM) DRAWING SLOTS & MASTER ENTRY ASSIGNMENT
// =========================================================================
adminRoutes.put('/tournaments/:id/draw-slot', async (c) => {
  const tournamentId = Number(c.req.param('id'));
  const body = await c.req.json<{
    slotTeamId: number;
    masterTeamId: number | null;
    squadLabel?: string;
    poolName?: string | null;
    isSeeded?: boolean;
  }>();

  const slotRow = await db.query.teams.findFirst({
    where: eq(teams.id, Number(body.slotTeamId)),
  });
  if (!slotRow || slotRow.tournamentId !== tournamentId) {
    return c.json({ error: 'Slot undian tidak ditemukan pada kategori ini' }, 404);
  }

  // Case A: Clear slot back to empty `[ Undian XX ]`
  if (body.masterTeamId === null) {
    const slotNum = String(slotRow.seed || 1).padStart(2, '0');
    const [cleared] = await db
      .update(teams)
      .set({
        masterTeamId: null,
        squadLabel: '',
        isSeeded: false,
        name: `[ Undian ${slotNum} ]`,
        shortCode: `U${slotNum}`,
        school: '',
        logoUrl: null,
        coachName: '',
        managerName: '',
        jerseyColors: '[]',
      })
      .where(eq(teams.id, slotRow.id))
      .returning();

    await broadcastEvent('draw_slot_updated', {
      tournamentId,
      teamId: cleared!.id,
      masterTeamId: null,
      slotNumber: cleared!.seed,
      poolName: cleared!.poolName,
      teamName: cleared!.name,
      school: '',
      logoUrl: null,
      cleared: true,
      timestamp: Date.now(),
    });
    await broadcastEvent('bracket_updated', { tournamentId });
    return c.json({ team: cleared });
  }

  // Case B: Assign a Master Team (with optional Squad A/B) into this TM Draw Slot
  const master = await db.query.masterTeams.findFirst({
    where: eq(masterTeams.id, Number(body.masterTeamId)),
  });
  if (!master) {
    return c.json({ error: 'Kontingen di Master Tim tidak ditemukan' }, 404);
  }

  const cleanSquad = sanitizePlainText(body.squadLabel || '', 8).toUpperCase();
  const catTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.tournamentId, tournamentId));

  const conflict = catTeams.find(
    (t) =>
      t.id !== slotRow.id &&
      t.masterTeamId === master.id &&
      (t.squadLabel || '').toUpperCase() === cleanSquad
  );
  if (conflict) {
    return c.json(
      {
        error: `${master.name}${cleanSquad ? ` (Tim ${cleanSquad})` : ''} sudah terpasang di slot #${String(conflict.seed).padStart(2, '0')}. Gunakan opsi "+ Skuad B" bila mengirim tim kedua.`,
      },
      409
    );
  }

  const entryName = formatSquadEntryName(master.name, cleanSquad);
  const entryShort = formatSquadShortCode(master.shortCode, cleanSquad);

  const [updatedSlot] = await db
    .update(teams)
    .set({
      masterTeamId: master.id,
      squadLabel: cleanSquad,
      isSeeded: body.isSeeded !== undefined ? Boolean(body.isSeeded) : slotRow.isSeeded,
      poolName:
        body.poolName !== undefined
          ? sanitizePoolCode(body.poolName)
          : slotRow.poolName,
      name: entryName,
      shortCode: entryShort,
      school: master.school,
      logoUrl: master.logoUrl,
      color: master.color,
      coachName: master.defaultCoachName,
      managerName: master.defaultManagerName,
      jerseyColors: master.defaultJerseyColors,
    })
    .where(eq(teams.id, slotRow.id))
    .returning();

  await broadcastEvent('draw_slot_updated', {
    tournamentId,
    teamId: updatedSlot!.id,
    masterTeamId: master.id,
    slotNumber: updatedSlot!.seed,
    poolName: updatedSlot!.poolName,
    teamName: updatedSlot!.name,
    school: updatedSlot!.school,
    logoUrl: updatedSlot!.logoUrl,
    cleared: false,
    timestamp: Date.now(),
  });
  await broadcastEvent('bracket_updated', { tournamentId });
  return c.json({ team: updatedSlot });
});

adminRoutes.post('/tournaments/:id/entries-from-master', async (c) => {
  const tournamentId = Number(c.req.param('id'));
  const body = await c.req.json<{
    masterTeamIds: number[];
    squadLabel?: string;
    poolName?: string | null;
  }>();

  if (!Array.isArray(body.masterTeamIds) || body.masterTeamIds.length === 0) {
    return c.json({ error: 'Pilih minimal 1 tim dari Master Kontingen' }, 400);
  }

  const existingTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.tournamentId, tournamentId));
  let nextSeed = existingTeams.length + 1;
  const cleanSquad = sanitizePlainText(body.squadLabel || '', 8).toUpperCase();
  const cleanPool = sanitizePoolCode(body.poolName);

  const masters = await db
    .select()
    .from(masterTeams)
    .where(inArray(masterTeams.id, body.masterTeamIds.map(Number)));
  const masterById = new Map(masters.map((m) => [m.id, m]));

  const createdEntries = [];
  for (const mId of body.masterTeamIds) {
    const master = masterById.get(Number(mId));
    if (!master) continue;

    const alreadyInCat = existingTeams.some(
      (t) =>
        t.masterTeamId === master.id &&
        (t.squadLabel || '').toUpperCase() === cleanSquad
    );
    if (alreadyInCat) continue;

    const [inserted] = await db
      .insert(teams)
      .values({
        tournamentId,
        masterTeamId: master.id,
        squadLabel: cleanSquad,
        isSeeded: false,
        name: formatSquadEntryName(master.name, cleanSquad),
        shortCode: formatSquadShortCode(master.shortCode, cleanSquad),
        school: master.school,
        logoUrl: master.logoUrl,
        color: master.color,
        seed: nextSeed++,
        poolName: cleanPool,
        coachName: master.defaultCoachName,
        managerName: master.defaultManagerName,
        jerseyColors: master.defaultJerseyColors,
      })
      .returning();
    createdEntries.push(inserted);
  }

  await broadcastEvent('tournament_updated', { tournamentId });
  return c.json({ teams: createdEntries }, 201);
});

// Bracket Generation, Pool Stage, & Drawing Slots
adminRoutes.post('/tournaments/:id/init-draw', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req
    .json<{ slotCount?: 4 | 8 | 16 | 32 }>()
    .catch(() => ({ slotCount: 16 as const }));
  const count =
    body.slotCount === 4 || body.slotCount === 8 || body.slotCount === 32
      ? body.slotCount
      : 16;
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
  const body = await c.req
    .json<{ shuffle?: boolean; separateSameRegion?: boolean }>()
    .catch(() => ({ shuffle: false, separateSameRegion: true }));
  try {
    await db
      .update(tournaments)
      .set({ format: 'knockout' })
      .where(eq(tournaments.id, id));
    const generated = await generateBracket(id, Boolean(body.shuffle), {
      separateSameRegion: body.separateSameRegion ?? true,
    });
    await broadcastEvent('bracket_updated', { tournamentId: id });
    return c.json({ matches: generated });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminRoutes.post('/tournaments/:id/generate-pools', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req
    .json<{
      poolCount?: number;
      advancePerPool?: number;
      shuffle?: boolean;
      separateSameRegion?: boolean;
    }>()
    .catch(
      () =>
        ({} as {
          poolCount?: number;
          advancePerPool?: number;
          shuffle?: boolean;
          separateSameRegion?: boolean;
        })
    );
  try {
    const generated = await generatePoolStageBracket(id, {
      poolCount: body.poolCount,
      advancePerPool: body.advancePerPool,
      shuffle: Boolean(body.shuffle),
      separateSameRegion: body.separateSameRegion ?? true,
    });
    await broadcastEvent('bracket_updated', { tournamentId: id });
    return c.json({ matches: generated });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminRoutes.post('/tournaments/:id/advance-pools', async (c) => {
  const id = Number(c.req.param('id'));
  try {
    const updatedMatches = await advancePoolsToKnockout(id);
    await broadcastEvent('bracket_updated', { tournamentId: id });
    return c.json({ matches: updatedMatches });
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
      | 'timeout'
      | 'sub'
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
      case 'timeout':
      case 'sub':
        if (!body.team || (body.delta !== 1 && body.delta !== -1)) {
          return c.json({ error: 'Parameter team dan delta wajib valid' }, 400);
        }
        result = await adjustSetCounter(id, body.action, body.team, body.delta);
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
  const body = await c.req.json<{
    courtName?: string;
    scheduledAt?: string | null;
    stageLabel?: string;
  }>();

  const updateData: Partial<typeof matches.$inferInsert> = {};
  if (body.courtName !== undefined) {
    updateData.courtName = sanitizePlainText(body.courtName, 40) || 'Court 1';
  }
  if (body.scheduledAt !== undefined) {
    updateData.scheduledAt = body.scheduledAt ? sanitizePlainText(body.scheduledAt, 60) : null;
  }
  if (body.stageLabel !== undefined) {
    updateData.stageLabel = sanitizePlainText(body.stageLabel, 80) || null;
  }

  await db
    .update(matches)
    .set(updateData)
    .where(eq(matches.id, id));

  const fullUpdated = await getMatchWithSets(id);
  await broadcastEvent('match_updated', fullUpdated);
  return c.json({ match: fullUpdated });
});

// =========================================================================
// MASTER COURTS REGISTRY & CROSS-COURT SCHEDULE ALLOCATOR
// =========================================================================
adminRoutes.get('/master-courts', async (c) => {
  const list = await db
    .select()
    .from(masterCourts)
    .orderBy(asc(masterCourts.sortOrder), asc(masterCourts.id));
  return c.json({ courts: list });
});

adminRoutes.post('/master-courts', async (c) => {
  const body = await c.req.json<{ name?: string; shortCode?: string }>();
  const name = sanitizePlainText(body.name, 60);
  if (!name) {
    return c.json({ error: 'Nama lapangan wajib diisi' }, 400);
  }
  const existing = await db.select().from(masterCourts);
  if (existing.some((ct) => ct.name.trim().toLowerCase() === name.toLowerCase())) {
    return c.json({ error: `Lapangan "${name}" sudah terdaftar` }, 409);
  }

  const shortCode =
    sanitizePlainText(body.shortCode, 12).toUpperCase() ||
    name.slice(0, 8).toUpperCase();

  const [created] = await db
    .insert(masterCourts)
    .values({
      name,
      shortCode,
      sortOrder: existing.length + 1,
      isEnabled: true,
      createdAt: Date.now(),
    })
    .returning();

  await broadcastEvent('courts_updated', { created });
  return c.json({ court: created }, 201);
});

adminRoutes.patch('/master-courts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const prev = await db.query.masterCourts.findFirst({
    where: eq(masterCourts.id, id),
  });
  if (!prev) {
    return c.json({ error: 'Data lapangan tidak ditemukan' }, 404);
  }

  const body = await c.req.json<{
    name?: string;
    shortCode?: string;
    isEnabled?: boolean;
    sortOrder?: number;
  }>();

  const patch: Partial<typeof masterCourts.$inferInsert> = {};
  if (body.name !== undefined) {
    const cleanName = sanitizePlainText(body.name, 60);
    if (cleanName) patch.name = cleanName;
  }
  if (body.shortCode !== undefined) {
    const cleanCode = sanitizePlainText(body.shortCode, 12).toUpperCase();
    if (cleanCode) patch.shortCode = cleanCode;
  }
  if (body.isEnabled !== undefined) patch.isEnabled = Boolean(body.isEnabled);
  if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder) || 0;

  const [updated] = await db
    .update(masterCourts)
    .set(patch)
    .where(eq(masterCourts.id, id))
    .returning();

  // Propagate renamed courtName cleanly to matches currently assigned to prev.name
  if (patch.name && patch.name !== prev.name) {
    await db
      .update(matches)
      .set({ courtName: patch.name })
      .where(eq(matches.courtName, prev.name));
  }

  await broadcastEvent('courts_updated', { updated });
  return c.json({ court: updated });
});

adminRoutes.delete('/master-courts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await db.query.masterCourts.findFirst({
    where: eq(masterCourts.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Data lapangan tidak ditemukan' }, 404);
  }
  const allCourts = await db.select().from(masterCourts);
  if (allCourts.length <= 1) {
    return c.json({ error: 'Minimal harus tersisa 1 lapangan aktif' }, 400);
  }

  await db.delete(masterCourts).where(eq(masterCourts.id, id));
  await broadcastEvent('courts_updated', { deletedId: id });
  return c.json({ ok: true });
});

adminRoutes.post('/matches/bulk-schedule-assign', async (c) => {
  const body = await c.req.json<{
    updates: Array<{ matchId: number; courtName?: string; scheduledAt?: string }>;
  }>();

  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    return c.json({ error: 'Daftar perubahan jadwal wajib diisi' }, 400);
  }

  const updatedMatches = [];
  for (const item of body.updates.slice(0, 120)) {
    const mId = Number(item.matchId);
    if (!Number.isFinite(mId)) continue;

    const patch: Partial<typeof matches.$inferInsert> = {};
    if (item.courtName !== undefined) {
      patch.courtName = sanitizePlainText(item.courtName, 60) || 'Lapangan 1';
    }
    if (item.scheduledAt !== undefined) {
      patch.scheduledAt = sanitizePlainText(item.scheduledAt, 60);
    }
    if (Object.keys(patch).length === 0) continue;

    await db.update(matches).set(patch).where(eq(matches.id, mId));
    const mFull = await getMatchWithSets(mId);
    if (mFull) updatedMatches.push(mFull);
  }

  if (updatedMatches.length > 0) {
    await broadcastEvent('bracket_updated', { bulkScheduleCount: updatedMatches.length });
    for (const m of updatedMatches.slice(0, 12)) {
      await broadcastEvent('match_updated', m);
    }
  }

  return c.json({ ok: true, count: updatedMatches.length, matches: updatedMatches });
});

adminRoutes.post('/matches/bulk-schedule-clear', async (c) => {
  const body = await c.req.json<{
    courtName?: string;
    matchIds?: number[];
  }>();

  if (body.courtName) {
    await db
      .update(matches)
      .set({ scheduledAt: null })
      .where(eq(matches.courtName, body.courtName));
  } else if (Array.isArray(body.matchIds) && body.matchIds.length > 0) {
    await db
      .update(matches)
      .set({ scheduledAt: null })
      .where(inArray(matches.id, body.matchIds));
  } else {
    return c.json({ error: 'Parameter courtName atau matchIds wajib diisi' }, 400);
  }

  await broadcastEvent('bracket_updated', { scheduleCleared: true, courtName: body.courtName });
  return c.json({ ok: true });
});

// =========================================================================
// MULTI-TV SCREENS REMOTE CONTROLLER & DYNAMIC STANDBY BANNER
// =========================================================================
function slugifyTvScreen(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `tv-${Date.now().toString(36)}`
  );
}

adminRoutes.get('/tv-screens', async (c) => {
  const list = await db
    .select()
    .from(tvScreens)
    .orderBy(asc(tvScreens.sortOrder), asc(tvScreens.id));
  return c.json({ screens: list });
});

adminRoutes.post('/tv-screens', async (c) => {
  const body = await c.req.json<{
    name?: string;
    slug?: string;
    mode?: 'single' | 'split' | 'bracket' | 'standby' | 'auto_rotate';
    courtId?: number | null;
    bannerPreset?: 'tm' | 'warmup' | 'break' | 'upcoming' | 'custom';
    bannerTitle?: string;
    bannerSubtitle?: string;
    bannerBadge?: string;
    bannerNoticeText?: string;
  }>();

  const name = sanitizePlainText(body.name, 60);
  if (!name) {
    return c.json({ error: 'Nama profil Layar TV wajib diisi' }, 400);
  }

  let slug = slugifyTvScreen(body.slug || name);
  const existing = await db.select().from(tvScreens);
  if (existing.some((s) => s.slug === slug)) {
    slug = `${slug}-${(existing.length + 1).toString(36)}`;
  }

  const now = Date.now();
  const validModes = ['single', 'split', 'bracket', 'standby', 'auto_rotate'] as const;
  const mode =
    body.mode && (validModes as readonly string[]).includes(body.mode)
      ? body.mode
      : 'single';
  const validPresets = ['tm', 'warmup', 'break', 'upcoming', 'custom'] as const;
  const bannerPreset =
    body.bannerPreset && (validPresets as readonly string[]).includes(body.bannerPreset)
      ? body.bannerPreset
      : 'tm';

  const [created] = await db
    .insert(tvScreens)
    .values({
      name,
      slug,
      mode,
      courtId: body.courtId ? Number(body.courtId) : null,
      bannerPreset,
      bannerTitle:
        sanitizePlainText(body.bannerTitle, 100) || 'TECHNICAL MEETING & DRAWING',
      bannerSubtitle:
        sanitizePlainText(body.bannerSubtitle, 140) ||
        'SMANSAGE VOLLEYBALL COMPETITION 2026',
      bannerBadge: sanitizePlainText(body.bannerBadge, 40) || 'LIVE DISPLAY',
      bannerNoticeText: sanitizePlainText(body.bannerNoticeText, 240) || '',
      showClock: true,
      showSponsors: true,
      sortOrder: existing.length + 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await broadcastEvent('tv_screen_updated', created);
  return c.json({ screen: created }, 201);
});

adminRoutes.patch('/tv-screens/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const prev = await db.query.tvScreens.findFirst({ where: eq(tvScreens.id, id) });
  if (!prev) {
    return c.json({ error: 'Profil Layar TV tidak ditemukan' }, 404);
  }

  const body = await c.req.json<{
    name?: string;
    mode?: 'single' | 'split' | 'bracket' | 'standby' | 'auto_rotate';
    courtId?: number | null;
    targetMatchId?: number | null;
    secondaryMatchId?: number | null;
    bracketTournamentId?: number | null;
    bannerPreset?: 'tm' | 'warmup' | 'break' | 'upcoming' | 'custom';
    bannerTitle?: string;
    bannerSubtitle?: string;
    bannerBadge?: string;
    bannerNoticeText?: string;
    showClock?: boolean;
    showSponsors?: boolean;
    resetCustomBanner?: boolean;
  }>();

  const patch: Partial<typeof tvScreens.$inferInsert> = { updatedAt: Date.now() };
  if (body.name !== undefined) {
    const clean = sanitizePlainText(body.name, 60);
    if (clean) patch.name = clean;
  }
  if (body.mode !== undefined) {
    const validModes = ['single', 'split', 'bracket', 'standby', 'auto_rotate'] as const;
    if ((validModes as readonly string[]).includes(body.mode)) patch.mode = body.mode;
  }
  if (body.courtId !== undefined) {
    patch.courtId = body.courtId === null ? null : Number(body.courtId) || null;
  }
  if (body.targetMatchId !== undefined) {
    patch.targetMatchId =
      body.targetMatchId === null ? null : Number(body.targetMatchId) || null;
  }
  if (body.secondaryMatchId !== undefined) {
    patch.secondaryMatchId =
      body.secondaryMatchId === null ? null : Number(body.secondaryMatchId) || null;
  }
  if (body.bracketTournamentId !== undefined) {
    patch.bracketTournamentId =
      body.bracketTournamentId === null
        ? null
        : Number(body.bracketTournamentId) || null;
  }
  if (body.bannerPreset !== undefined) {
    const validPresets = ['tm', 'warmup', 'break', 'upcoming', 'custom'] as const;
    if ((validPresets as readonly string[]).includes(body.bannerPreset)) {
      patch.bannerPreset = body.bannerPreset;
    }
  }
  if (body.bannerTitle !== undefined) {
    patch.bannerTitle = sanitizePlainText(body.bannerTitle, 100);
  }
  if (body.bannerSubtitle !== undefined) {
    patch.bannerSubtitle = sanitizePlainText(body.bannerSubtitle, 140);
  }
  if (body.bannerBadge !== undefined) {
    patch.bannerBadge = sanitizePlainText(body.bannerBadge, 40);
  }
  if (body.bannerNoticeText !== undefined) {
    patch.bannerNoticeText = sanitizePlainText(body.bannerNoticeText, 240);
  }
  if (body.showClock !== undefined) patch.showClock = Boolean(body.showClock);
  if (body.showSponsors !== undefined) patch.showSponsors = Boolean(body.showSponsors);
  if (body.resetCustomBanner) {
    if (prev.customBannerUrl) await deleteUploadedImage(prev.customBannerUrl);
    patch.customBannerUrl = null;
  }

  const [updated] = await db
    .update(tvScreens)
    .set(patch)
    .where(eq(tvScreens.id, id))
    .returning();

  await broadcastEvent('tv_screen_updated', updated);
  return c.json({ screen: updated });
});

adminRoutes.post('/tv-screens/:id/banner', async (c) => {
  const id = Number(c.req.param('id'));
  const prev = await db.query.tvScreens.findFirst({ where: eq(tvScreens.id, id) });
  if (!prev) {
    return c.json({ error: 'Profil Layar TV tidak ditemukan' }, 404);
  }
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'File gambar banner wajib diunggah' }, 400);
  }

  const url = await saveUploadedImage(file, 'logos');
  const [updated] = await db
    .update(tvScreens)
    .set({ customBannerUrl: url, updatedAt: Date.now() })
    .where(eq(tvScreens.id, id))
    .returning();

  if (prev.customBannerUrl && prev.customBannerUrl !== url) {
    await deleteUploadedImage(prev.customBannerUrl);
  }

  await broadcastEvent('tv_screen_updated', updated);
  return c.json({ screen: updated });
});

adminRoutes.delete('/tv-screens/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await db.query.tvScreens.findFirst({ where: eq(tvScreens.id, id) });
  if (!existing) {
    return c.json({ error: 'Profil Layar TV tidak ditemukan' }, 404);
  }
  if (existing.customBannerUrl) {
    await deleteUploadedImage(existing.customBannerUrl);
  }
  await db.delete(tvScreens).where(eq(tvScreens.id, id));
  await broadcastEvent('tv_screen_updated', { deletedId: id, slug: existing.slug });
  return c.json({ ok: true });
});

// =============================================================================
// OBS Broadcast Overlays & Token-Gated Remote Controller (/api/admin/obs-overlays)
// =============================================================================

function slugifyObsName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'stream';
}

const VALID_OBS_LAYOUTS = new Set([
  'scorebug_corner',
  'lower_third',
  'match_intro',
  'timeout_break',
  'winner_card',
]);
const VALID_OBS_THEMES = new Set(['dark', 'light', 'glass']);

adminRoutes.get('/obs-overlays', async (c) => {
  const list = await db.select().from(obsOverlays).orderBy(asc(obsOverlays.id));
  return c.json({ overlays: list });
});

adminRoutes.post('/obs-overlays', async (c) => {
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({} as Record<string, unknown>));
  const name = sanitizePlainText(String(body.name || ''), 60).trim() || 'Stream Baru';
  const baseSlug = slugifyObsName(String(body.slug || name));
  const existing = await db.select().from(obsOverlays);
  const usedSlugs = new Set(existing.map((o) => o.slug));
  let slug = baseSlug;
  let n = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${n++}`;
  }

  const rawToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const accessToken =
    /^[a-zA-Z0-9_-]{6,64}$/.test(rawToken) ? rawToken : randomBytes(12).toString('hex');

  const layoutPreset = VALID_OBS_LAYOUTS.has(String(body.layoutPreset))
    ? (String(body.layoutPreset) as typeof obsOverlays.$inferInsert.layoutPreset)
    : 'lower_third';
  const themeMode = VALID_OBS_THEMES.has(String(body.themeMode))
    ? (String(body.themeMode) as typeof obsOverlays.$inferInsert.themeMode)
    : 'dark';
  const now = Date.now();

  const [created] = await db
    .insert(obsOverlays)
    .values({
      name,
      slug,
      accessToken,
      layoutPreset,
      themeMode,
      matchId: typeof body.matchId === 'number' ? body.matchId : null,
      courtName: sanitizePlainText(String(body.courtName || ''), 60).trim(),
      autoFollowCourt: body.autoFollowCourt !== false,
      showSponsorTicker: body.showSponsorTicker !== false,
      showSetHistory: body.showSetHistory !== false,
      showTimeoutSub: body.showTimeoutSub !== false,
      isVisible: body.isVisible !== false,
      customBadgeText:
        sanitizePlainText(String(body.customBadgeText || 'LIVE BROADCAST'), 40).trim() ||
        'LIVE BROADCAST',
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await broadcastEvent('obs_overlay_updated', { slug: created!.slug, id: created!.id });
  return c.json({ overlay: created }, 201);
});

adminRoutes.patch('/obs-overlays/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const prev = await db.query.obsOverlays.findFirst({ where: eq(obsOverlays.id, id) });
  if (!prev) return c.json({ error: 'Profil OBS tidak ditemukan' }, 404);

  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({} as Record<string, unknown>));
  const patch: Partial<typeof obsOverlays.$inferInsert> = { updatedAt: Date.now() };

  if (typeof body.name === 'string' && body.name.trim()) {
    patch.name = sanitizePlainText(body.name, 60).trim();
  }
  if (typeof body.accessToken === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(body.accessToken.trim())) {
    patch.accessToken = body.accessToken.trim();
  }
  if (typeof body.layoutPreset === 'string' && VALID_OBS_LAYOUTS.has(body.layoutPreset)) {
    patch.layoutPreset = body.layoutPreset as typeof obsOverlays.$inferInsert.layoutPreset;
  }
  if (typeof body.themeMode === 'string' && VALID_OBS_THEMES.has(body.themeMode)) {
    patch.themeMode = body.themeMode as typeof obsOverlays.$inferInsert.themeMode;
  }
  if (body.matchId === null || typeof body.matchId === 'number') {
    patch.matchId = body.matchId;
  }
  if (typeof body.courtName === 'string') {
    patch.courtName = sanitizePlainText(body.courtName, 60).trim();
  }
  if (typeof body.autoFollowCourt === 'boolean') patch.autoFollowCourt = body.autoFollowCourt;
  if (typeof body.showSponsorTicker === 'boolean') patch.showSponsorTicker = body.showSponsorTicker;
  if (typeof body.showSetHistory === 'boolean') patch.showSetHistory = body.showSetHistory;
  if (typeof body.showTimeoutSub === 'boolean') patch.showTimeoutSub = body.showTimeoutSub;
  if (typeof body.isVisible === 'boolean') patch.isVisible = body.isVisible;
  if (typeof body.customBadgeText === 'string') {
    patch.customBadgeText = sanitizePlainText(body.customBadgeText, 40).trim();
  }

  const [updated] = await db
    .update(obsOverlays)
    .set(patch)
    .where(eq(obsOverlays.id, id))
    .returning();

  await broadcastEvent('obs_overlay_updated', { slug: updated!.slug, id: updated!.id });
  return c.json({ overlay: updated });
});

adminRoutes.post('/obs-overlays/:id/regenerate-token', async (c) => {
  const id = Number(c.req.param('id'));
  const prev = await db.query.obsOverlays.findFirst({ where: eq(obsOverlays.id, id) });
  if (!prev) return c.json({ error: 'Profil OBS tidak ditemukan' }, 404);

  const newToken = randomBytes(12).toString('hex');
  const [updated] = await db
    .update(obsOverlays)
    .set({ accessToken: newToken, updatedAt: Date.now() })
    .where(eq(obsOverlays.id, id))
    .returning();

  await broadcastEvent('obs_overlay_updated', { slug: updated!.slug, id: updated!.id });
  return c.json({ overlay: updated });
});

adminRoutes.delete('/obs-overlays/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await db.query.obsOverlays.findFirst({ where: eq(obsOverlays.id, id) });
  if (!existing) return c.json({ error: 'Profil OBS tidak ditemukan' }, 404);
  await db.delete(obsOverlays).where(eq(obsOverlays.id, id));
  await broadcastEvent('obs_overlay_updated', { deletedId: id, slug: existing.slug });
  return c.json({ ok: true });
});

// =============================================================================
// Optional Team Roster / Players for FIVB Form O-2 (/api/admin/teams/:id/players)
// =============================================================================

adminRoutes.get('/teams/:id/players', async (c) => {
  const teamId = Number(c.req.param('id'));
  const list = await db
    .select()
    .from(teamPlayers)
    .where(eq(teamPlayers.teamId, teamId))
    .orderBy(asc(teamPlayers.jerseyNumber), asc(teamPlayers.id));
  return c.json({ players: list });
});

adminRoutes.post('/teams/:id/players', async (c) => {
  const teamId = Number(c.req.param('id'));
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  if (!team) return c.json({ error: 'Tim tidak ditemukan' }, 404);

  const body = await c.req.json<{
    jerseyNumber?: number;
    name?: string;
    role?: 'player' | 'captain' | 'libero';
  }>().catch(() => ({ jerseyNumber: 0, name: '', role: 'player' as const }));

  const jerseyNumber = Number(body.jerseyNumber);
  const name = sanitizePlainText(body.name || '', 60).trim();
  if (!Number.isInteger(jerseyNumber) || jerseyNumber < 1 || jerseyNumber > 99) {
    return c.json({ error: 'Nomor punggung harus 1–99' }, 400);
  }
  if (!name) return c.json({ error: 'Nama pemain wajib diisi' }, 400);

  const role =
    body.role === 'captain' || body.role === 'libero' ? body.role : 'player';

  const [created] = await db
    .insert(teamPlayers)
    .values({
      teamId,
      masterTeamId: team.masterTeamId ?? null,
      jerseyNumber,
      name,
      role,
      createdAt: Date.now(),
    })
    .returning();

  return c.json({ player: created }, 201);
});

adminRoutes.delete('/players/:playerId', async (c) => {
  const playerId = Number(c.req.param('playerId'));
  const existing = await db.query.teamPlayers.findFirst({
    where: eq(teamPlayers.id, playerId),
  });
  if (!existing) return c.json({ error: 'Pemain tidak ditemukan' }, 404);
  await db.delete(teamPlayers).where(eq(teamPlayers.id, playerId));
  return c.json({ ok: true });
});

// =============================================================================
// Outbound Webhooks (/api/admin/webhooks)
// =============================================================================

adminRoutes.get('/webhooks', async (c) => {
  const rows = await db.select().from(webhooks).orderBy(desc(webhooks.id));
  return c.json({
    webhooks: rows.map((w) => ({
      ...w,
      secret: w.secret ? '••••••••' : '',
      hasSecret: Boolean(w.secret),
    })),
  });
});

adminRoutes.post('/webhooks', async (c) => {
  const body = await c.req.json<{
    name?: string;
    url?: string;
    secret?: string;
    platform?: 'generic' | 'discord' | 'telegram';
    events?: string[];
  }>().catch(() => ({
    name: '',
    url: '',
    secret: '',
    platform: 'generic' as const,
    events: [] as string[],
  }));

  const name = sanitizePlainText(body.name || '', 60).trim();
  const url = String(body.url || '').trim();
  if (!name || !url) {
    return c.json({ error: 'Nama dan URL webhook wajib diisi' }, 400);
  }
  if (!(await isSafeWebhookUrl(url))) {
    return c.json(
      { error: 'URL webhook tidak valid atau mengarah ke jaringan internal yang diblokir' },
      400
    );
  }

  const platform =
    body.platform === 'discord' || body.platform === 'telegram' ? body.platform : 'generic';
  const validEvents = new Set(['match_started', 'set_confirmed', 'match_finished']);
  const events = Array.isArray(body.events)
    ? body.events.filter((e) => validEvents.has(e))
    : ['match_started', 'set_confirmed', 'match_finished'];

  const [created] = await db
    .insert(webhooks)
    .values({
      name,
      url,
      secret: String(body.secret || '').trim(),
      platform,
      eventsJson: JSON.stringify(events.length > 0 ? events : ['match_finished']),
      isEnabled: true,
      createdAt: Date.now(),
    })
    .returning();

  return c.json(
    {
      webhook: {
        ...created!,
        secret: created!.secret ? '••••••••' : '',
        hasSecret: Boolean(created!.secret),
      },
    },
    201
  );
});

adminRoutes.patch('/webhooks/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await db.query.webhooks.findFirst({ where: eq(webhooks.id, id) });
  if (!existing) return c.json({ error: 'Webhook tidak ditemukan' }, 404);

  const body = await c.req
    .json<{ isEnabled?: boolean }>()
    .catch(() => ({} as { isEnabled?: boolean }));
  const [updated] = await db
    .update(webhooks)
    .set({
      isEnabled: typeof body.isEnabled === 'boolean' ? body.isEnabled : existing.isEnabled,
    })
    .where(eq(webhooks.id, id))
    .returning();

  return c.json({
    webhook: {
      ...updated!,
      secret: updated!.secret ? '••••••••' : '',
      hasSecret: Boolean(updated!.secret),
    },
  });
});

adminRoutes.post('/webhooks/:id/test', async (c) => {
  const id = Number(c.req.param('id'));
  try {
    const result = await sendTestWebhook(id);
    return c.json({ ok: !result.error, result });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminRoutes.delete('/webhooks/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await db.delete(webhooks).where(eq(webhooks.id, id));
  return c.json({ ok: true });
});

// =============================================================================
// SQLite Snapshot Backups to S3 (/api/admin/backups)
// =============================================================================

adminRoutes.get('/backups', async (c) => {
  try {
    const listing = await listS3Backups();
    return c.json(listing);
  } catch (err) {
    return c.json({ s3Configured: true, backups: [], error: (err as Error).message });
  }
});

adminRoutes.post('/backups/run', async (c) => {
  try {
    const snapshot = await createSqliteS3Backup();
    return c.json({ ok: true, snapshot });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

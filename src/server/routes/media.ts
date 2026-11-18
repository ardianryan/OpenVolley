import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { type ReportMediaItem, serializeReportMedia } from '../../shared/gallery-media';
import { sanitizePlainText } from '../../shared/sanitize';
import { db } from '../db';
import { matchReports } from '../db/schema';
import { type AuthUser, requireAuth } from '../middleware/auth';
import { broadcastEvent } from '../services/sse';
import {
  deleteUploadedReportAssets,
  saveUploadedImage,
  saveUploadedReportVideo,
} from '../services/upload';

export const mediaRoutes = new Hono<{ Variables: { user: AuthUser } }>();

mediaRoutes.use('*', requireAuth(['admin', 'panitia', 'media']));

mediaRoutes.post('/reports', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  const rawSlides = form
    .getAll('slides')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const rawVideo = form.get('video');
  const videoFile = rawVideo instanceof File && rawVideo.size > 0 ? rawVideo : null;

  const matchId = Number(form.get('matchId'));
  const rawCaption = String(form.get('caption') || '').trim();
  if (rawCaption.length > 300) {
    return c.json({ error: 'Caption maksimal 300 karakter' }, 400);
  }
  const caption = sanitizePlainText(rawCaption, 300);

  const rawSnapshot = String(form.get('scoreSnapshot') || '{}');
  if (rawSnapshot.length > 2000) {
    return c.json({ error: 'Data ringkasan skor tidak valid' }, 400);
  }
  let scoreSnapshot = '{}';
  try {
    const parsed = JSON.parse(rawSnapshot) as Record<string, unknown>;
    scoreSnapshot = JSON.stringify({
      teamA: sanitizePlainText(parsed.teamA, 20),
      teamB: sanitizePlainText(parsed.teamB, 20),
      scoreText: sanitizePlainText(parsed.scoreText, 60),
    });
  } catch {
    scoreSnapshot = '{}';
  }

  if (!(file instanceof File) || !matchId) {
    return c.json({ error: 'Foto utama dan pertandingan wajib dipilih' }, 400);
  }

  if (rawSlides.length > 3) {
    return c.json({ error: 'Maksimal 3 foto tambahan dalam satu unggahan slide' }, 400);
  }

  const uploadedUrls: string[] = [];
  try {
    const imagePath = await saveUploadedImage(file, 'reports');
    uploadedUrls.push(imagePath);

    const mediaItems: ReportMediaItem[] = [];

    if (videoFile) {
      const videoUrl = await saveUploadedReportVideo(videoFile);
      uploadedUrls.push(videoUrl);
      mediaItems.push({
        type: 'video',
        url: videoUrl,
        posterUrl: imagePath,
        label: 'Video Momen',
      });
    }

    mediaItems.push({
      type: 'image',
      url: imagePath,
      label: 'Poster Pertandingan',
    });

    for (let idx = 0; idx < rawSlides.length; idx++) {
      const slideFile = rawSlides[idx]!;
      const slideUrl = await saveUploadedImage(slideFile, 'reports');
      uploadedUrls.push(slideUrl);
      mediaItems.push({
        type: 'image',
        url: slideUrl,
        label: `Foto Momen ${idx + 1}`,
      });
    }

    const mediaJson = serializeReportMedia(mediaItems);
    const user = c.get('user');

    const [created] = await db
      .insert(matchReports)
      .values({
        matchId,
        uploadedBy: user.name,
        imagePath,
        mediaJson,
        caption,
        scoreSnapshot,
        createdAt: Date.now(),
      })
      .returning();

    await broadcastEvent('report_added', created);
    return c.json({ report: created }, 201);
  } catch (err) {
    for (const url of uploadedUrls) {
      await deleteUploadedReportAssets(url);
    }
    return c.json({ error: (err as Error).message }, 400);
  }
});

mediaRoutes.delete('/reports/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await db.query.matchReports.findFirst({
    where: eq(matchReports.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Laporan tidak ditemukan' }, 404);
  }

  await db.delete(matchReports).where(eq(matchReports.id, id));
  await deleteUploadedReportAssets(existing.imagePath, existing.mediaJson);

  await broadcastEvent('report_deleted', { id });
  return c.json({ ok: true });
});

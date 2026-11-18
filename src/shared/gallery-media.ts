import { sanitizeAssetUrl, sanitizePlainText } from './sanitize';

export interface ReportMediaItem {
  type: 'image' | 'video';
  url: string;
  posterUrl?: string;
  label?: string;
}

const MAX_GALLERY_ITEMS = 6;

/**
 * Parses `media_json` from a `match_reports` record with full anti-XSS URL sanitization
 * and backward-compatible fallback to `imagePath` for single-photo legacy reports.
 */
export function parseReportMedia(
  imagePath: string,
  mediaJson?: string | null
): ReportMediaItem[] {
  const safeCover = sanitizeAssetUrl(imagePath, '');
  const result: ReportMediaItem[] = [];

  if (typeof mediaJson === 'string' && mediaJson.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(mediaJson) as unknown[];
      if (Array.isArray(parsed)) {
        for (const raw of parsed.slice(0, MAX_GALLERY_ITEMS)) {
          if (!raw || typeof raw !== 'object') continue;
          const obj = raw as Record<string, unknown>;
          const type = obj.type === 'video' ? 'video' : 'image';
          const url = sanitizeAssetUrl(obj.url, '');
          if (!url) continue;

          const posterUrl = sanitizeAssetUrl(obj.posterUrl, '');
          const label = sanitizePlainText(obj.label, 80);

          const item: ReportMediaItem = { type, url };
          if (posterUrl) item.posterUrl = posterUrl;
          else if (type === 'video' && safeCover) item.posterUrl = safeCover;
          if (label) item.label = label;

          result.push(item);
        }
      }
    } catch {
      // Fall back to cover image below
    }
  }

  if (result.length === 0 && safeCover) {
    result.push({
      type: 'image',
      url: safeCover,
      label: 'Poster Pertandingan',
    });
  }

  return result;
}

export function serializeReportMedia(items: ReportMediaItem[]): string {
  const cleaned: ReportMediaItem[] = [];
  for (const item of items.slice(0, MAX_GALLERY_ITEMS)) {
    const url = sanitizeAssetUrl(item.url, '');
    if (!url) continue;
    const next: ReportMediaItem = {
      type: item.type === 'video' ? 'video' : 'image',
      url,
    };
    const poster = sanitizeAssetUrl(item.posterUrl, '');
    if (poster) next.posterUrl = poster;
    const label = sanitizePlainText(item.label, 80);
    if (label) next.label = label;
    cleaned.push(next);
  }
  return JSON.stringify(cleaned);
}

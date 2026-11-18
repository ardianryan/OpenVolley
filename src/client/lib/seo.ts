import type { OfficialDocSettings, JerseyColorItem, SiteSettings } from '../types';

export function parseOfficialDocSettings(json?: string | null): OfficialDocSettings {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as OfficialDocSettings) : {};
  } catch {
    return {};
  }
}

export function parseJerseyColors(json?: string | null): JerseyColorItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is JerseyColorItem =>
        Boolean(x && typeof x.label === 'string' && typeof x.hex === 'string')
    );
  } catch {
    return [];
  }
}

export function syncDocumentBranding(
  settings?: SiteSettings | null,
  pagePrefix?: string
) {
  if (typeof document === 'undefined' || !settings) return;

  const eventName = settings.eventName?.trim() || 'Smansage Volleyball Competition';
  const subtitle = settings.eventSubtitle?.trim() || 'Live Score & Bagan Resmi';
  document.title = pagePrefix
    ? `${pagePrefix} • ${eventName}`
    : `${eventName} | Live Score & Bagan Resmi`;

  const descContent =
    settings.seoDescription?.trim() ||
    `Portal Resmi Live Score Real-Time, Klasemen, Bagan Turnamen, dan Dokumen Pertandingan ${eventName} (${subtitle}).`;

  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    metaDesc.setAttribute('content', descContent);
  }

  const logoHref = settings.logoUrl?.trim() || '/brand/svc-crest-color.svg';
  const mime = logoHref.toLowerCase().split('?')[0]?.endsWith('.svg')
    ? 'image/svg+xml'
    : 'image/png';

  let fav = document.getElementById('ov-favicon') as HTMLLinkElement | null;
  if (!fav) {
    fav = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  }
  if (fav) {
    fav.type = mime;
    fav.href = logoHref;
  }
}

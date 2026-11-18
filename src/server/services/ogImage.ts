import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { createHash } from 'node:crypto';
import { sanitizeHexColor } from '../../shared/sanitize';
import { getFullOverview } from './overview';
import { getOverviewVersion, onCacheInvalidate } from './sse';

let wasmReadyPromise: Promise<void> | null = null;
let cachedFontBuffers: Uint8Array[] | null = null;

let cachedPng: { key: string; bytes: Uint8Array } | null = null;
const embeddedAssetCache = new Map<string, string | null>();

onCacheInvalidate(() => {
  cachedPng = null;
});

async function ensureResvgReady(): Promise<Uint8Array[]> {
  if (!wasmReadyPromise) {
    wasmReadyPromise = (async () => {
      const wasmFile = Bun.file('./node_modules/@resvg/resvg-wasm/index_bg.wasm');
      const buf = await wasmFile.arrayBuffer();
      await initWasm(buf);
    })();
  }
  await wasmReadyPromise;

  if (!cachedFontBuffers) {
    const buffers: Uint8Array[] = [];
    for (const fontPath of [
      './public/fonts/BarlowCondensed-ExtraBold.ttf',
      './public/fonts/PlusJakartaSans-Bold.ttf',
    ]) {
      const f = Bun.file(fontPath);
      if (await f.exists()) {
        buffers.push(new Uint8Array(await f.arrayBuffer()));
      }
    }
    cachedFontBuffers = buffers;
  }

  return cachedFontBuffers;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeHtmlAttr(input: string): string {
  return escapeXml(input);
}

function mimeFromUrl(url: string): string {
  const clean = url.split('?')[0]!.toLowerCase();
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

async function resolveLogoDataUri(url?: string | null): Promise<string | null> {
  if (!url) return null;
  if (embeddedAssetCache.has(url)) {
    return embeddedAssetCache.get(url) ?? null;
  }

  try {
    let bytes: Uint8Array | null = null;
    const mime = mimeFromUrl(url);

    if (url.startsWith('/brand/')) {
      const f = Bun.file(`./public${url.split('?')[0]}`);
      if (await f.exists()) {
        bytes = new Uint8Array(await f.arrayBuffer());
      }
    } else if (url.startsWith('/uploads/')) {
      const rel = url.split('?')[0]!;
      // Prevent path traversal
      if (!rel.includes('..')) {
        const f = Bun.file(`./data${rel}`);
        if (await f.exists()) {
          bytes = new Uint8Array(await f.arrayBuffer());
        }
      }
    } else if (url.startsWith('https://') || url.startsWith('http://')) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) {
          bytes = new Uint8Array(await res.arrayBuffer());
        }
      } finally {
        clearTimeout(timer);
      }
    }

    if (!bytes || bytes.byteLength === 0) {
      embeddedAssetCache.set(url, null);
      return null;
    }

    // Cap cache size
    if (embeddedAssetCache.size > 60) {
      embeddedAssetCache.clear();
    }

    const b64 = Buffer.from(bytes).toString('base64');
    const dataUri = `data:${mime};base64,${b64}`;
    embeddedAssetCache.set(url, dataUri);
    return dataUri;
  } catch {
    return null;
  }
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['TURNAMEN BOLA VOLI'];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }

  const consumedWords = lines.join(' ').split(/\s+/).filter(Boolean).length;
  const remaining = words.slice(consumedWords).join(' ');
  if (remaining) {
    const clipped =
      remaining.length > maxCharsPerLine + 3
        ? `${remaining.slice(0, maxCharsPerLine).trimEnd()}…`
        : remaining;
    lines.push(clipped);
  } else if (current && lines.length < maxLines) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

export function buildEffectiveSeoMeta(settings?: {
  eventName?: string;
  eventSubtitle?: string;
  eventMeta?: string;
  seoDescription?: string;
  logoUrl?: string;
  socialImageUrl?: string;
} | null) {
  const eventName = settings?.eventName?.trim() || 'Smansage Volleyball Competition';
  const eventSubtitle =
    settings?.eventSubtitle?.trim() || 'AVERSA • Dies Natalis 44 SMA Negeri 1 Gedeg';
  const eventMeta = settings?.eventMeta?.trim() || 'Turnamen Bola Voli Resmi';

  const title = `${eventName} | Live Score & Bagan Resmi`;
  const description =
    settings?.seoDescription?.trim() ||
    `Portal Resmi Live Score Real-Time, Klasemen, Bagan Turnamen, dan Dokumen Pertandingan ${eventName} (${eventSubtitle}).`;
  const faviconHref = settings?.logoUrl?.trim() || '/brand/svc-crest-color.svg';
  const customSocialUrl = settings?.socialImageUrl?.trim() || '';

  return {
    eventName,
    eventSubtitle,
    eventMeta,
    title,
    description,
    faviconHref,
    customSocialUrl,
  };
}

/**
 * Generates a crisp 1200x630 PNG social preview card using active siteSettings + live tournament stats.
 */
export async function generateDynamicOgImagePng(): Promise<{
  bytes: Uint8Array;
  etag: string;
}> {
  const overview = await getFullOverview(false);
  const s = overview.settings;
  const ver = getOverviewVersion();

  const liveMatchesCount = overview.matches.filter((m) => m.status === 'live').length;
  const totalTeams = overview.teams.length;
  const categoryNames = overview.tournaments.map((t) => t.name).slice(0, 3);

  const digestSource = JSON.stringify({
    ver,
    eventName: s?.eventName,
    eventSubtitle: s?.eventSubtitle,
    eventMeta: s?.eventMeta,
    accentColor: s?.accentColor,
    logoUrl: s?.logoUrl,
    coBrandLogoUrl: s?.coBrandLogoUrl,
    organizerLogoUrl: s?.organizerLogoUrl,
    liveMatchesCount,
    totalTeams,
    categoryNames,
  });
  const hash = createHash('sha1').update(digestSource).digest('hex').slice(0, 12);

  if (cachedPng && cachedPng.key === hash) {
    return { bytes: cachedPng.bytes, etag: `"og-${hash}"` };
  }

  const fontBuffers = await ensureResvgReady();
  const accent = sanitizeHexColor(s?.accentColor || '#E09D17', '#E09D17');
  const meta = buildEffectiveSeoMeta(s);

  const mainLogoUri = await resolveLogoDataUri(meta.faviconHref);
  const coBrandUri = await resolveLogoDataUri(s?.coBrandLogoUrl);
  const organizerUri = await resolveLogoDataUri(s?.organizerLogoUrl);

  const titleLines = wrapLines(meta.eventName.toUpperCase(), 22, 3);
  const titleFontSize = titleLines.length >= 3 ? 58 : titleLines.length === 2 ? 68 : 76;
  const titleLineHeight = Math.round(titleFontSize * 1.03);
  const titleStartY = titleLines.length >= 3 ? 236 : 254;

  const subtitleClipped =
    meta.eventSubtitle.length > 62
      ? `${meta.eventSubtitle.slice(0, 60).trimEnd()}…`
      : meta.eventSubtitle;
  const metaClipped =
    meta.eventMeta.length > 44
      ? `${meta.eventMeta.slice(0, 42).trimEnd()}…`
      : meta.eventMeta;

  const statusLabel =
    liveMatchesCount > 0
      ? `${liveMatchesCount} PERTANDINGAN SEDANG LIVE`
      : 'LIVE SCORE • BAGAN • BULETIN RESMI';
  const statusDotColor = liveMatchesCount > 0 ? '#EF4444' : accent;

  const statCategoryText =
    overview.tournaments.length > 0
      ? `${overview.tournaments.length} Kategori Pertandingan`
      : 'Portal Turnamen Resmi';
  const statTeamsText = totalTeams > 0 ? `${totalTeams} Kontingen Terdaftar` : metaClipped;

  const titleSvgNodes = titleLines
    .map(
      (line, idx) =>
        `<text x="72" y="${titleStartY + idx * titleLineHeight}" font-family="Barlow Condensed, Plus Jakarta Sans, sans-serif" font-weight="800" font-size="${titleFontSize}" fill="#F8FAFC" letter-spacing="0.8">${escapeXml(line)}</text>`
    )
    .join('\n');

  const subtitleY = titleStartY + (titleLines.length - 1) * titleLineHeight + 52;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#090D16" />
      <stop offset="55%" stop-color="#0F172A" />
      <stop offset="100%" stop-color="#131C31" />
    </linearGradient>
    <linearGradient id="accentRibbon" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.32" />
      <stop offset="100%" stop-color="${accent}" stop-opacity="0.04" />
    </linearGradient>
    <linearGradient id="crestGlow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1E293B" stop-opacity="0.92" />
      <stop offset="100%" stop-color="#0B1120" stop-opacity="0.96" />
    </linearGradient>
  </defs>

  <!-- Base Canvas -->
  <rect width="1200" height="630" fill="url(#bgGrad)" />

  <!-- Subtle Volleyball Court Net Grid -->
  <g stroke="#334155" stroke-opacity="0.24" stroke-width="1">
    <line x1="0" y1="126" x2="1200" y2="126" />
    <line x1="0" y1="252" x2="1200" y2="252" />
    <line x1="0" y1="378" x2="1200" y2="378" />
    <line x1="0" y1="504" x2="1200" y2="504" />
    <line x1="240" y1="0" x2="240" y2="630" />
    <line x1="480" y1="0" x2="480" y2="630" />
    <line x1="720" y1="0" x2="720" y2="630" />
    <line x1="960" y1="0" x2="960" y2="630" />
  </g>

  <!-- Diagonal Sport Championship Ribbons -->
  <polygon points="770,0 1200,0 1200,630 610,630" fill="url(#accentRibbon)" />
  <polygon points="752,0 770,0 610,630 592,630" fill="${accent}" fill-opacity="0.65" />

  <!-- Top Accent Bar -->
  <rect x="0" y="0" width="1200" height="8" fill="${accent}" />

  <!-- Top Status & Partner Pill Row -->
  <rect x="72" y="58" width="388" height="44" rx="22" fill="#1E293B" stroke="${accent}" stroke-opacity="0.55" stroke-width="1.5" />
  <circle cx="98" cy="80" r="7" fill="${statusDotColor}" />
  <text x="116" y="86" font-family="Plus Jakarta Sans, sans-serif" font-weight="700" font-size="16" fill="#F8FAFC" letter-spacing="0.8">${escapeXml(statusLabel)}</text>

  ${
    organizerUri
      ? `<g>
          <rect x="478" y="54" width="52" height="52" rx="14" fill="#FFFFFF" fill-opacity="0.95" />
          <image href="${organizerUri}" x="485" y="61" width="38" height="38" preserveAspectRatio="xMidYMid meet" />
        </g>`
      : ''
  }
  ${
    coBrandUri
      ? `<g>
          <rect x="${organizerUri ? 540 : 478}" y="54" width="52" height="52" rx="14" fill="#FFFFFF" fill-opacity="0.95" />
          <image href="${coBrandUri}" x="${organizerUri ? 547 : 485}" y="61" width="38" height="38" preserveAspectRatio="xMidYMid meet" />
        </g>`
      : ''
  }

  <!-- Main Championship Headline -->
  ${titleSvgNodes}

  <!-- Subtitle & Event Meta -->
  <text x="72" y="${subtitleY}" font-family="Plus Jakarta Sans, sans-serif" font-weight="700" font-size="24" fill="${accent}">${escapeXml(subtitleClipped)}</text>
  <text x="72" y="${subtitleY + 34}" font-family="Plus Jakarta Sans, sans-serif" font-weight="700" font-size="18" fill="#94A3B8">${escapeXml(metaClipped)}</text>

  <!-- Bottom Info Chips -->
  <g transform="translate(72, 524)">
    <rect x="0" y="0" width="286" height="48" rx="12" fill="#0F172A" stroke="#334155" stroke-width="1.5" />
    <rect x="14" y="14" width="8" height="20" rx="4" fill="${accent}" />
    <text x="34" y="30" font-family="Plus Jakarta Sans, sans-serif" font-weight="700" font-size="16" fill="#E2E8F0">${escapeXml(statCategoryText)}</text>

    <rect x="302" y="0" width="290" height="48" rx="12" fill="#0F172A" stroke="#334155" stroke-width="1.5" />
    <rect x="316" y="14" width="8" height="20" rx="4" fill="#38BDF8" />
    <text x="336" y="30" font-family="Plus Jakarta Sans, sans-serif" font-weight="700" font-size="16" fill="#E2E8F0">${escapeXml(statTeamsText)}</text>
  </g>

  <!-- Right Emblem Showcase Card -->
  <g transform="translate(824, 98)">
    <rect x="0" y="0" width="312" height="434" rx="32" fill="url(#crestGlow)" stroke="${accent}" stroke-opacity="0.6" stroke-width="2" />
    <rect x="24" y="24" width="264" height="328" rx="22" fill="#FFFFFF" fill-opacity="0.04" />
    ${
      mainLogoUri
        ? `<image href="${mainLogoUri}" x="38" y="42" width="236" height="292" preserveAspectRatio="xMidYMid meet" />`
        : `<circle cx="156" cy="188" r="88" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="4" />
           <text x="156" y="206" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="56" fill="${accent}">SVC</text>`
    }
    <rect x="36" y="372" width="240" height="38" rx="19" fill="${accent}" />
    <text x="156" y="397" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-weight="700" font-size="15" fill="#090D16" letter-spacing="1.1">PORTAL RESMI TURNAMEN</text>
  </g>
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontBuffers,
      defaultFontFamily: 'Plus Jakarta Sans',
      sansSerifFamily: 'Plus Jakarta Sans',
    },
  });

  const rendered = resvg.render();
  const pngBytes = new Uint8Array(rendered.asPng());
  rendered.free();
  resvg.free();

  cachedPng = { key: hash, bytes: pngBytes };
  return { bytes: pngBytes, etag: `"og-${hash}"` };
}

/**
 * Injects dynamic title, description, favicon (SVC Crest or uploaded logo), and OpenGraph/Twitter meta tags
 * into index.html for crawlers and initial page loads.
 */
export async function injectDynamicHtmlMeta(
  rawHtml: string,
  originUrl: string
): Promise<string> {
  const overview = await getFullOverview(false);
  const s = overview.settings;
  const ver = getOverviewVersion();
  const meta = buildEffectiveSeoMeta(s);

  const ogImageUrl = meta.customSocialUrl
    ? meta.customSocialUrl.startsWith('http')
      ? meta.customSocialUrl
      : `${originUrl}${meta.customSocialUrl}`
    : `${originUrl}/api/public/og-image.png?v=${ver}`;

  const canonicalUrl = `${originUrl}/`;
  const faviconMime = mimeFromUrl(meta.faviconHref);

  const safeTitle = escapeHtmlAttr(meta.title);
  const safeDesc = escapeHtmlAttr(meta.description);
  const safeFavicon = escapeHtmlAttr(meta.faviconHref);
  const safeOgImage = escapeHtmlAttr(ogImageUrl);
  const safeCanonical = escapeHtmlAttr(canonicalUrl);
  const safeShortName = escapeHtmlAttr(meta.eventName.slice(0, 30));

  let html = rawHtml;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`);
  html = html.replace(
    /<meta\s+name="description"[\s\S]*?\/>/i,
    `<meta name="description" content="${safeDesc}" />`
  );
  html = html.replace(
    /<meta\s+name="apple-mobile-web-app-title"[\s\S]*?\/>/i,
    `<meta name="apple-mobile-web-app-title" content="${safeShortName}" />`
  );
  html = html.replace(
    /<link\s+[^>]*rel="icon"[^>]*\/>/i,
    `<link id="ov-favicon" rel="icon" type="${faviconMime}" href="${safeFavicon}" />`
  );

  const socialBlock = [
    `<!-- ov:social:start -->`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtmlAttr(meta.eventName)}" />`,
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDesc}" />`,
    `<meta property="og:url" content="${safeCanonical}" />`,
    `<meta property="og:image" content="${safeOgImage}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
    `<meta name="twitter:image" content="${safeOgImage}" />`,
    `<!-- ov:social:end -->`,
  ].join('\n    ');

  if (html.includes('<!-- ov:social:start -->')) {
    html = html.replace(
      /<!-- ov:social:start -->[\s\S]*?<!-- ov:social:end -->/,
      socialBlock
    );
  } else {
    html = html.replace('</head>', `    ${socialBlock}\n  </head>`);
  }

  return html;
}

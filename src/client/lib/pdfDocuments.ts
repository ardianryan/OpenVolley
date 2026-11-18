import { jsPDF } from 'jspdf';
import { computePoolStandings } from '../../shared/pool';
import {
  groupMatchesByScheduleDay,
  parseScheduleDayAndTime,
} from '../../shared/schedule';
import { formatInternationalStageLabel } from '../../shared/stages';
import type {
  Match,
  OfficialDocSettings,
  OverviewData,
  SiteSettings,
  Team,
  Tournament,
} from '../types';
import { parseJerseyColors, parseOfficialDocSettings } from './seo';
import { toCorsSafeAssetUrl } from './assetUrl';

type RgbTuple = [number, number, number];

interface RasterAsset {
  dataUrl: string;
  width: number;
  height: number;
  aspect: number;
  isVeryDark: boolean;
}

const rasterCache = new Map<string, RasterAsset | null>();

function hexToRgb(hex: string | undefined, fallback: RgbTuple = [224, 157, 23]): RgbTuple {
  if (!hex) return fallback;
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    return [r, g, b];
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return [r, g, b];
  }
  return fallback;
}

function mixWithWhite(rgb: RgbTuple, weight = 0.9): RgbTuple {
  return [
    Math.round(rgb[0] * (1 - weight) + 255 * weight),
    Math.round(rgb[1] * (1 - weight) + 255 * weight),
    Math.round(rgb[2] * (1 - weight) + 255 * weight),
  ];
}

function truncatePdfText(doc: jsPDF, text: string, maxWidthMm: number): string {
  const clean = (text || '').trim();
  if (!clean) return '';
  if (doc.getTextWidth(clean) <= maxWidthMm) return clean;
  let sliced = clean;
  while (sliced.length > 1 && doc.getTextWidth(`${sliced}...`) > maxWidthMm) {
    sliced = sliced.slice(0, -1);
  }
  return `${sliced.trimEnd()}...`;
}

async function loadRasterAsset(
  url?: string | null,
  options?: {
    maxDim?: number;
    opacity?: number;
    mode?: 'contain' | 'cover';
    aspect?: number;
    trimAlpha?: boolean;
  }
): Promise<RasterAsset | null> {
  const safeUrl = toCorsSafeAssetUrl(url);
  if (!safeUrl || typeof document === 'undefined') return null;
  const maxDim = options?.maxDim ?? 360;
  const opacity = options?.opacity ?? 1;
  const mode = options?.mode ?? 'contain';
  const aspect = options?.aspect ?? 1;
  const trimAlpha = options?.trimAlpha ?? mode === 'contain';
  const cacheKey = `${safeUrl}|${maxDim}|${opacity}|${mode}|${aspect}|${trimAlpha ? 1 : 0}`;

  if (rasterCache.has(cacheKey)) {
    return rasterCache.get(cacheKey) ?? null;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timeout = window.setTimeout(() => {
      rasterCache.set(cacheKey, null);
      resolve(null);
    }, 4500);

    img.onload = () => {
      window.clearTimeout(timeout);
      try {
        const natW = img.naturalWidth || 256;
        const natH = img.naturalHeight || 256;

        let canvasW = maxDim;
        let canvasH = Math.round(maxDim / aspect);
        if (mode === 'contain') {
          const scale = Math.min(maxDim / natW, maxDim / natH, 2);
          canvasW = Math.max(16, Math.round(natW * scale));
          canvasH = Math.max(16, Math.round(natH * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.globalAlpha = opacity;

        if (mode === 'cover') {
          const scale = Math.max(canvasW / natW, canvasH / natH);
          const drawW = natW * scale;
          const drawH = natH * scale;
          ctx.drawImage(img, (canvasW - drawW) / 2, (canvasH - drawH) / 2, drawW, drawH);
        } else {
          ctx.drawImage(img, 0, 0, canvasW, canvasH);
        }

        let finalCanvas = canvas;
        let finalW = canvasW;
        let finalH = canvasH;
        let isVeryDark = false;

        if (mode === 'contain') {
          const imgData = ctx.getImageData(0, 0, canvasW, canvasH);
          const px = imgData.data;
          let minX = canvasW;
          let minY = canvasH;
          let maxX = -1;
          let maxY = -1;
          let lumSum = 0;
          let lumCount = 0;

          for (let y = 0; y < canvasH; y++) {
            const rowOff = y * canvasW * 4;
            for (let x = 0; x < canvasW; x++) {
              const i = rowOff + x * 4;
              const a = px[i + 3]!;
              if (a > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
              if (a > 40) {
                lumSum += 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
                lumCount++;
              }
            }
          }

          if (lumCount > 0) {
            isVeryDark = lumSum / lumCount < 48;
          }

          if (trimAlpha && maxX >= minX && maxY >= minY) {
            const cropW = Math.max(8, maxX - minX + 1);
            const cropH = Math.max(8, maxY - minY + 1);
            if (cropW < canvasW - 2 || cropH < canvasH - 2) {
              const trimmed = document.createElement('canvas');
              trimmed.width = cropW;
              trimmed.height = cropH;
              const tCtx = trimmed.getContext('2d');
              if (tCtx) {
                tCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
                finalCanvas = trimmed;
                finalW = cropW;
                finalH = cropH;
              }
            }
          }
        }

        const asset: RasterAsset = {
          dataUrl: finalCanvas.toDataURL('image/png'),
          width: finalW,
          height: finalH,
          aspect: finalW / Math.max(1, finalH),
          isVeryDark,
        };
        if (rasterCache.size > 120) rasterCache.clear();
        rasterCache.set(cacheKey, asset);
        resolve(asset);
      } catch {
        rasterCache.set(cacheKey, null);
        resolve(null);
      }
    };

    img.onerror = () => {
      window.clearTimeout(timeout);
      rasterCache.set(cacheKey, null);
      resolve(null);
    };

    img.src = safeUrl;
  });
}

function addContainedImage(
  doc: jsPDF,
  asset: RasterAsset,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
) {
  const scale = Math.min(boxW / Math.max(1, asset.width), boxH / Math.max(1, asset.height));
  const drawW = asset.width * scale;
  const drawH = asset.height * scale;
  const drawX = boxX + (boxW - drawW) / 2;
  const drawY = boxY + (boxH - drawH) / 2;
  doc.addImage(asset.dataUrl, 'PNG', drawX, drawY, drawW, drawH, undefined, 'FAST');
}

function getRoundStageLabel(
  match: Match,
  totalMainRounds: number
): string {
  return formatInternationalStageLabel(match, totalMainRounds);
}

function formatIndonesianDateNow(): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function slugifyFilename(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'openvolley'
  );
}

interface LoadedBrandLogos {
  mainLogo: RasterAsset | null;
  coBrandLogo: RasterAsset | null;
  organizerLogo: RasterAsset | null;
  watermarkLogo: RasterAsset | null;
}

function drawInteriorPageShell(
  doc: jsPDF,
  settings: SiteSettings,
  docMeta: OfficialDocSettings,
  sectionTitle: string,
  sectionBadge: string,
  logos: LoadedBrandLogos,
  accentRgb: RgbTuple
) {
  // Subtle center watermark (aspect-preserved)
  if (logos.watermarkLogo) {
    addContainedImage(doc, logos.watermarkLogo, 55, 98, 100, 100);
  }

  // Top accent bar
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 0, 210, 2.4, 'F');

  // Header brand logos & title (aspect-preserved, adaptive width for horizontal wordmarks)
  let textLeftX = 14;
  if (logos.organizerLogo) {
    const orgW = Math.min(24, Math.max(10.5, 10 * logos.organizerLogo.aspect));
    addContainedImage(doc, logos.organizerLogo, 14, 7.2, orgW, 10.5);
    textLeftX = 14 + orgW + 2.8;
  }
  if (logos.mainLogo) {
    const mainW = Math.min(24, Math.max(11, 11 * logos.mainLogo.aspect));
    addContainedImage(doc, logos.mainLogo, 196 - mainW, 6.8, mainW, 11.2);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    truncatePdfText(doc, settings.eventName.toUpperCase(), 118),
    textLeftX,
    11.8
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  const subHeader = `${docMeta.bulletinNumber || 'BULETIN RESMI'}  •  ${settings.eventSubtitle || settings.eventMeta}`;
  doc.text(truncatePdfText(doc, subHeader, 122), textLeftX, 16);

  // Divider line
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.35);
  doc.line(14, 20, 196, 20);

  // Section Banner Strip
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(14, 23, 182, 9.5, 1.8, 1.8, 'F');

  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.roundedRect(14, 23, 3.2, 9.5, 1.2, 1.2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(248, 250, 252);
  doc.text(truncatePdfText(doc, sectionTitle.toUpperCase(), 130), 20.5, 29.1);

  if (sectionBadge) {
    const badgeText = sectionBadge.toUpperCase();
    doc.setFontSize(7.2);
    const bw = Math.min(48, doc.getTextWidth(badgeText) + 6);
    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.roundedRect(193 - bw, 25, bw, 5.5, 1.4, 1.4, 'F');
    doc.setTextColor(15, 23, 42);
    doc.text(truncatePdfText(doc, badgeText, bw - 4), 193 - bw / 2, 28.8, {
      align: 'center',
    });
  }
}

function stampAllPageFooters(
  doc: jsPDF,
  settings: SiteSettings,
  docMeta: OfficialDocSettings
) {
  const totalPages = doc.getNumberOfPages();
  const dateLabel = docMeta.publishedDate?.trim() || formatIndonesianDateNow();

  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(14, 285, 196, 285);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      truncatePdfText(
        doc,
        `Dokumen Resmi ${settings.eventName} • Diterbitkan: ${dateLabel}`,
        140
      ),
      14,
      290
    );

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(51, 65, 85);
    doc.text(`Halaman ${p} / ${totalPages}`, 196, 290, { align: 'right' });
  }
}

export interface BulletinDownloadOptions {
  tournamentIds?: number[];
  docSettingsOverride?: OfficialDocSettings;
}

/**
 * Generates and downloads the Official Tournament Bulletin PDF (A4 Portrait):
 * - Page 1: Dynamic Championship Cover (or uploaded custom cover)
 * - Section 1: Contingent / Pool Cards (with dynamic optional Coach/Manager/Jersey fields)
 * - Section 2: Pool Standings (if pool_knockout) + Schedule & Results Table
 * - Section 3: Full-Page Vector Main Knockout Bracket per Category (stops cleanly here, no O-2 forms)
 */
export async function downloadTournamentBulletinPdf(
  overview: OverviewData,
  options?: BulletinDownloadOptions
): Promise<void> {
  const settings = overview.settings;
  const savedDocMeta = parseOfficialDocSettings(settings.docSettingsJson);
  const docMeta: OfficialDocSettings = {
    ...savedDocMeta,
    ...options?.docSettingsOverride,
  };

  const selectedTournaments = overview.tournaments.filter((t) =>
    options?.tournamentIds && options.tournamentIds.length > 0
      ? options.tournamentIds.includes(t.id)
      : true
  );
  const activeTournaments =
    selectedTournaments.length > 0 ? selectedTournaments : overview.tournaments;

  const accentRgb = hexToRgb(settings.accentColor, [224, 157, 23]);

  // Preload brand & team logos concurrently (with true aspect-ratio & alpha bounds)
  const [mainLogo, coBrandLogo, organizerLogo, watermarkLogo, customCover] =
    await Promise.all([
      loadRasterAsset(settings.logoUrl || '/brand/svc-crest-color.svg', {
        maxDim: 480,
      }),
      loadRasterAsset(settings.coBrandLogoUrl, { maxDim: 420 }),
      loadRasterAsset(settings.organizerLogoUrl, { maxDim: 360 }),
      loadRasterAsset(settings.logoUrl || '/brand/svc-crest-color.svg', {
        maxDim: 380,
        opacity: 0.055,
      }),
      docMeta.coverImageUrl
        ? loadRasterAsset(docMeta.coverImageUrl, {
            maxDim: 1600,
            mode: 'cover',
            aspect: 210 / 297,
            trimAlpha: false,
          })
        : Promise.resolve(null),
    ]);

  const logos: LoadedBrandLogos = {
    mainLogo,
    coBrandLogo,
    organizerLogo,
    watermarkLogo,
  };

  const relevantTeamIds = new Set(
    overview.teams
      .filter((tm) => activeTournaments.some((t) => t.id === tm.tournamentId))
      .map((tm) => tm.id)
  );
  const teamLogoMap = new Map<number, RasterAsset>();
  await Promise.all(
    overview.teams
      .filter((tm) => relevantTeamIds.has(tm.id) && tm.logoUrl)
      .map(async (tm) => {
        const asset = await loadRasterAsset(tm.logoUrl, { maxDim: 220 });
        if (asset) teamLogoMap.set(tm.id, asset);
      })
  );

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  // =========================================================================
  // PAGE 1: CHAMPIONSHIP COVER PAGE
  // =========================================================================
  if (customCover) {
    doc.addImage(customCover.dataUrl, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  } else {
    // Deep Obsidian Championship Background
    doc.setFillColor(11, 15, 25);
    doc.rect(0, 0, 210, 297, 'F');

    // Subtle geometric court grid
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.25);
    for (let gx = 30; gx < 210; gx += 30) doc.line(gx, 0, gx, 297);
    for (let gy = 35; gy < 297; gy += 35) doc.line(0, gy, 210, gy);

    // Diagonal Sport Accent Ribbons
    doc.setFillColor(19, 28, 49);
    doc.triangle(210, 0, 210, 175, 78, 0, 'F');
    doc.triangle(0, 297, 145, 297, 0, 195, 'F');

    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.rect(0, 0, 210, 4.5, 'F');
    doc.rect(0, 292.5, 210, 4.5, 'F');

    // Top Partner & Organizer Logo Badges (Adaptive Width + True Aspect Ratio + Contrast-Aware)
    let badgeX = 18;
    const topBadges = [organizerLogo, coBrandLogo].filter(
      (b): b is RasterAsset => Boolean(b)
    );
    for (const badgeAsset of topBadges) {
      const pillH = 18;
      // Wide horizontal wordmarks (e.g. AVERSA ~ 2.85:1) get slightly sleeker height & generous width
      const innerH = badgeAsset.aspect > 1.8 ? 10.6 : 13.2;
      const innerW = Math.min(40, Math.max(13.2, innerH * badgeAsset.aspect));
      const pillW = innerW + 6.4;

      if (badgeAsset.isVeryDark) {
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
      } else {
        doc.setFillColor(19, 28, 46);
        doc.setDrawColor(51, 65, 85);
      }
      doc.setLineWidth(0.35);
      doc.roundedRect(badgeX, 18, pillW, pillH, 3.6, 3.6, 'FD');

      addContainedImage(
        doc,
        badgeAsset,
        badgeX + 3.2,
        18 + (pillH - innerH) / 2,
        innerW,
        innerH
      );
      badgeX += pillW + 4;
    }

    // Accent geometric stripe aligned cleanly under the top badge row
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(1.2);
    doc.line(18, 44, Math.min(92, Math.max(62, badgeX - 4)), 44);

    // Center Showcase Crest Card
    doc.setFillColor(17, 24, 39);
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.7);
    doc.roundedRect(55, 56, 100, 98, 8, 8, 'FD');

    if (mainLogo) {
      addContainedImage(doc, mainLogo, 65, 64, 80, 82);
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(34);
      doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.text('SVC', 105, 114, { align: 'center' });
    }

    // Bulletin Number Pill
    const bulletinTitle = (docMeta.bulletinNumber || 'BULETIN #1').toUpperCase();
    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.roundedRect(65, 164, 80, 11, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(11, 15, 25);
    doc.text(truncatePdfText(doc, bulletinTitle, 74), 105, 171.3, { align: 'center' });

    // Edition Label
    const editionLabel = (
      docMeta.bulletinEdition || 'HASIL TECHNICAL MEETING & BAGAN RESMI'
    ).toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.text(truncatePdfText(doc, editionLabel, 174), 105, 184, { align: 'center' });

    // Main Event Name (Auto-wrapped centered)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(23);
    doc.setTextColor(248, 250, 252);
    const eventLines = doc.splitTextToSize(
      (settings.eventName || 'TURNAMEN BOLA VOLI').toUpperCase(),
      174
    ) as string[];
    let curEventY = 197;
    for (const line of eventLines.slice(0, 3)) {
      doc.text(line, 105, curEventY, { align: 'center' });
      curEventY += 9.5;
    }

    // Event Subtitle
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(203, 213, 225);
    doc.text(
      truncatePdfText(doc, settings.eventSubtitle || '', 172),
      105,
      curEventY + 3,
      { align: 'center' }
    );

    // Bottom Metadata Summary Card
    doc.setFillColor(17, 24, 39);
    doc.setDrawColor(51, 65, 85);
    doc.setLineWidth(0.4);
    doc.roundedRect(18, 246, 174, 34, 4, 4, 'FD');

    const venueText = docMeta.venueName?.trim() || settings.eventMeta || 'Arena Utama';
    const pubDate = docMeta.publishedDate?.trim() || formatIndonesianDateNow();
    const catSummary = activeTournaments.map((t) => t.name).join('  •  ') || 'Umum';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.text('KATEGORI DIPERTANDINGKAN', 25, 254.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(248, 250, 252);
    doc.text(truncatePdfText(doc, catSummary, 160), 25, 260);

    doc.setDrawColor(30, 41, 59);
    doc.line(25, 264, 185, 264);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(truncatePdfText(doc, `Lokasi / Info: ${venueText}`, 105), 25, 272);
    doc.text(`Terbit: ${pubDate}`, 185, 272, { align: 'right' });
  }

  // =========================================================================
  // SECTION 1: CONTINGENT / POOL CARDS PER CATEGORY
  // =========================================================================
  for (const tournament of activeTournaments) {
    const catTeams = overview.teams
      .filter((t) => t.tournamentId === tournament.id)
      .sort((a, b) => a.seed - b.seed || a.id - b.id);

    if (catTeams.length === 0) continue;

    // Group teams by Pool (if pool_knockout or poolName exists) else by Draw Half
    const groups: Array<{ title: string; codePrefix: string; teams: Team[] }> = [];
    const hasExplicitPools =
      tournament.format === 'pool_knockout' || catTeams.some((t) => Boolean(t.poolName));

    if (hasExplicitPools) {
      const byPool = new Map<string, Team[]>();
      for (const t of catTeams) {
        const key = (t.poolName || 'A').toUpperCase();
        const arr = byPool.get(key) ?? [];
        arr.push(t);
        byPool.set(key, arr);
      }
      for (const poolKey of Array.from(byPool.keys()).sort()) {
        groups.push({
          title: `POOL ${poolKey}`,
          codePrefix: poolKey,
          teams: byPool.get(poolKey)!,
        });
      }
    } else if (catTeams.length >= 4) {
      const half = Math.ceil(catTeams.length / 2);
      groups.push({
        title: 'LEFT BRACKET (UPPER DRAW)',
        codePrefix: 'L',
        teams: catTeams.slice(0, half),
      });
      groups.push({
        title: 'RIGHT BRACKET (LOWER DRAW)',
        codePrefix: 'R',
        teams: catTeams.slice(half),
      });
    } else {
      groups.push({
        title: 'DAFTAR PESERTA',
        codePrefix: 'T',
        teams: catTeams,
      });
    }

    doc.addPage();
    drawInteriorPageShell(
      doc,
      settings,
      docMeta,
      `Daftar Kontingen & Pembagian Grup • ${tournament.name}`,
      `${catTeams.length} Tim`,
      logos,
      accentRgb
    );

    let cursorY = 37;

    for (const grp of groups) {
      // Check space for group header + at least 1 row
      if (cursorY > 246) {
        doc.addPage();
        drawInteriorPageShell(
          doc,
          settings,
          docMeta,
          `Daftar Kontingen & Pembagian Grup • ${tournament.name}`,
          `${catTeams.length} Tim`,
          logos,
          accentRgb
        );
        cursorY = 37;
      }

      // Group Sub-banner
      const softTint = mixWithWhite(accentRgb, 0.88);
      doc.setFillColor(softTint[0], softTint[1], softTint[2]);
      doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.setLineWidth(0.3);
      doc.roundedRect(14, cursorY, 182, 6.8, 1.4, 1.4, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(15, 23, 42);
      doc.text(`${grp.title}  (${grp.teams.length} Kontingen)`, 18, cursorY + 4.6);
      cursorY += 9.5;

      // Render 2-column Contingent Cards
      for (let i = 0; i < grp.teams.length; i += 2) {
        const pair = grp.teams.slice(i, i + 2);

        // Compute dynamic card height for this row based on optional metadata
        const rowHasExtras = pair.some((tm) => {
          const jerseys = parseJerseyColors(tm.jerseyColors);
          return Boolean(
            tm.coachName?.trim() || tm.managerName?.trim() || jerseys.length > 0
          );
        });
        const rowHasBothStaffAndJersey = pair.some((tm) => {
          const jerseys = parseJerseyColors(tm.jerseyColors);
          return (
            jerseys.length > 0 &&
            Boolean(tm.coachName?.trim() || tm.managerName?.trim())
          );
        });

        const cardH = rowHasBothStaffAndJersey ? 30 : rowHasExtras ? 25 : 19.5;

        if (cursorY + cardH > 278) {
          doc.addPage();
          drawInteriorPageShell(
            doc,
            settings,
            docMeta,
            `Daftar Kontingen & Pembagian Grup • ${tournament.name}`,
            `${catTeams.length} Tim`,
            logos,
            accentRgb
          );
          cursorY = 37;
        }

        pair.forEach((tm, colIdx) => {
          const cardX = colIdx === 0 ? 14 : 107;
          const cardW = 89;
          const teamRgb = hexToRgb(tm.color, accentRgb);
          const codeLabel = hasExplicitPools
            ? `${grp.codePrefix}${i + colIdx + 1}`
            : `#${String(tm.seed || i + colIdx + 1).padStart(2, '0')}`;

          // Card background & border
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(203, 213, 225);
          doc.setLineWidth(0.32);
          doc.roundedRect(cardX, cursorY, cardW, cardH, 2.2, 2.2, 'FD');

          // Left color accent bar
          doc.setFillColor(teamRgb[0], teamRgb[1], teamRgb[2]);
          doc.roundedRect(cardX, cursorY, 2.6, cardH, 1.2, 1.2, 'F');

          // Crest box
          doc.setFillColor(248, 250, 252);
          doc.setDrawColor(226, 232, 240);
          doc.roundedRect(cardX + 4.8, cursorY + 2.8, 13.5, 13.5, 2, 2, 'FD');

          const crestAsset = teamLogoMap.get(tm.id);
          if (crestAsset) {
            addContainedImage(doc, crestAsset, cardX + 5.8, cursorY + 3.8, 11.5, 11.5);
          } else {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(teamRgb[0], teamRgb[1], teamRgb[2]);
            doc.text(
              (tm.shortCode || tm.name.slice(0, 3)).toUpperCase(),
              cardX + 11.55,
              cursorY + 10.6,
              { align: 'center' }
            );
          }

          // Code pill (top-right)
          doc.setFillColor(241, 245, 249);
          doc.roundedRect(cardX + cardW - 14.5, cursorY + 2.6, 11.8, 5, 1.2, 1.2, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.8);
          doc.setTextColor(51, 65, 85);
          doc.text(codeLabel, cardX + cardW - 8.6, cursorY + 6, { align: 'center' });

          // Team Name & School
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.6);
          doc.setTextColor(15, 23, 42);
          doc.text(
            truncatePdfText(doc, tm.name, 52),
            cardX + 20.5,
            cursorY + 7.4
          );

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.2);
          doc.setTextColor(100, 116, 139);
          doc.text(
            truncatePdfText(doc, tm.school || tm.shortCode || '-', 64),
            cardX + 20.5,
            cursorY + 12.2
          );

          // Optional Jersey Colors + Coach/Manager (only rendered when present!)
          let extraY = cursorY + 18.8;
          const jerseys = parseJerseyColors(tm.jerseyColors);
          if (jerseys.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6.6);
            doc.setTextColor(71, 85, 105);
            doc.text('Kostum:', cardX + 5.2, extraY);

            let dotX = cardX + 16.8;
            for (const jc of jerseys.slice(0, 3)) {
              const jRgb = hexToRgb(jc.hex, [30, 41, 59]);
              doc.setFillColor(jRgb[0], jRgb[1], jRgb[2]);
              doc.setDrawColor(148, 163, 184);
              doc.setLineWidth(0.2);
              doc.circle(dotX, extraY - 1, 1.4, 'FD');
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(51, 65, 85);
              const lbl = truncatePdfText(doc, jc.label, 18);
              doc.text(lbl, dotX + 2.3, extraY);
              dotX += doc.getTextWidth(lbl) + 6.2;
              if (dotX > cardX + cardW - 14) break;
            }
            extraY += 4.6;
          }

          const staffParts: string[] = [];
          if (tm.coachName?.trim()) staffParts.push(`Pelatih: ${tm.coachName.trim()}`);
          if (tm.managerName?.trim()) staffParts.push(`Manajer: ${tm.managerName.trim()}`);
          if (staffParts.length > 0) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.6);
            doc.setTextColor(71, 85, 105);
            doc.text(
              truncatePdfText(doc, staffParts.join('  •  '), cardW - 9),
              cardX + 5.2,
              extraY
            );
          }
        });

        cursorY += cardH + 3.2;
      }

      cursorY += 2.5;
    }
  }

  // =========================================================================
  // SECTION 2A: POOL STANDINGS TABLES (ONLY FOR CATEGORIES USING POOL_KNOCKOUT)
  // =========================================================================
  const poolTournaments = activeTournaments.filter((t) => t.format === 'pool_knockout');
  for (const tournament of poolTournaments) {
    const catTeams = overview.teams.filter((t) => t.tournamentId === tournament.id);
    const catMatches = overview.matches.filter((m) => m.tournamentId === tournament.id);
    const standingsMap = computePoolStandings(catTeams, catMatches, tournament.bestOf);
    const poolKeys = Object.keys(standingsMap).sort();
    if (poolKeys.length === 0) continue;

    doc.addPage();
    drawInteriorPageShell(
      doc,
      settings,
      docMeta,
      `Klasemen Fase Pool (FIVB) • ${tournament.name}`,
      `Top ${tournament.advancePerPool || 2} Lolos`,
      logos,
      accentRgb
    );

    let y = 37;
    for (const pKey of poolKeys) {
      const rows = standingsMap[pKey] ?? [];
      const tableH = 14 + rows.length * 6.8;
      if (y + tableH > 276) {
        doc.addPage();
        drawInteriorPageShell(
          doc,
          settings,
          docMeta,
          `Klasemen Fase Pool (FIVB) • ${tournament.name}`,
          `Top ${tournament.advancePerPool || 2} Lolos`,
          logos,
          accentRgb
        );
        y = 37;
      }

      // Pool header
      doc.setFillColor(30, 41, 59);
      doc.roundedRect(14, y, 182, 6.8, 1.2, 1.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(`POOL ${pKey}`, 18, y + 4.6);

      doc.setFontSize(6.8);
      doc.setTextColor(203, 213, 225);
      doc.text('POS', 16, y + 11);
      doc.text('TIM / KONTINGEN', 27, y + 11);
      doc.text('MAIN', 112, y + 11, { align: 'center' });
      doc.text('M - K', 127, y + 11, { align: 'center' });
      doc.text('POIN', 143, y + 11, { align: 'center' });
      doc.text('SET', 160, y + 11, { align: 'center' });
      doc.text('SKOR POIN', 182, y + 11, { align: 'center' });

      // Subheader background
      doc.setFillColor(241, 245, 249);
      doc.rect(14, y + 7.2, 182, 5.6, 'F');
      doc.setTextColor(51, 65, 85);
      doc.text('POS', 17, y + 11);
      doc.text('TIM / KONTINGEN', 28, y + 11);
      doc.text('MAIN', 112, y + 11, { align: 'center' });
      doc.text('M - K', 127, y + 11, { align: 'center' });
      doc.text('PTS', 143, y + 11, { align: 'center' });
      doc.text('SET', 160, y + 11, { align: 'center' });
      doc.text('POIN RALLY', 182, y + 11, { align: 'center' });

      let rowY = y + 12.8;
      const advLimit = tournament.advancePerPool ?? 2;

      rows.forEach((r, rIdx) => {
        const isAdvancing = rIdx < advLimit;
        if (isAdvancing) {
          const tint = mixWithWhite(accentRgb, 0.92);
          doc.setFillColor(tint[0], tint[1], tint[2]);
        } else {
          doc.setFillColor(rIdx % 2 === 0 ? 255 : 248, rIdx % 2 === 0 ? 255 : 250, rIdx % 2 === 0 ? 255 : 252);
        }
        doc.rect(14, rowY, 182, 6.6, 'F');
        doc.setDrawColor(226, 232, 240);
        doc.line(14, rowY + 6.6, 196, rowY + 6.6);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(15, 23, 42);
        doc.text(String(rIdx + 1), 19, rowY + 4.5, { align: 'center' });
        doc.text(truncatePdfText(doc, r.team.name, 76), 28, rowY + 4.5);

        doc.setFont('helvetica', 'normal');
        doc.text(String(r.played), 112, rowY + 4.5, { align: 'center' });
        doc.text(`${r.won} - ${r.lost}`, 127, rowY + 4.5, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.text(String(r.matchPoints), 143, rowY + 4.5, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.text(`${r.setsWon}-${r.setsLost}`, 160, rowY + 4.5, { align: 'center' });
        doc.text(`${r.pointsWon}-${r.pointsLost}`, 182, rowY + 4.5, { align: 'center' });

        rowY += 6.6;
      });

      y = rowY + 6;
    }
  }

  // =========================================================================
  // SECTION 2B: SCHEDULE & RESULTS TABLE (GROUPED CHRONOLOGICALLY PER DAY)
  // =========================================================================
  const teamById = new Map(overview.teams.map((t) => [t.id, t]));
  const tournamentById = new Map(activeTournaments.map((t) => [t.id, t]));

  const maxMainRoundByCat = new Map<number, number>();
  for (const t of activeTournaments) {
    const mainRounds = overview.matches
      .filter((m) => m.tournamentId === t.id && m.bracketType === 'main')
      .map((m) => m.round);
    maxMainRoundByCat.set(t.id, mainRounds.length > 0 ? Math.max(...mainRounds) : 1);
  }

  const rawRelevantMatches = overview.matches.filter(
    (m) => tournamentById.has(m.tournamentId) && m.status !== 'bye'
  );
  const { dayGroups, orderedMatches: allRelevantMatches } =
    groupMatchesByScheduleDay(rawRelevantMatches);

  // Map matchId -> display Match Number (#1..#N) in chronological schedule order
  const matchSeqNum = new Map<number, number>();
  allRelevantMatches.forEach((m, idx) => {
    matchSeqNum.set(m.id, idx + 1);
  });

  // Reverse lookup: feeder matches pointing into (nextMatchId, slot)
  const feederLabelMap = new Map<string, string>();
  for (const m of overview.matches) {
    const num = matchSeqNum.get(m.id);
    if (m.nextMatchId && m.nextMatchSlot && num) {
      feederLabelMap.set(`${m.nextMatchId}:${m.nextMatchSlot}`, `Pemenang M#${num}`);
    }
    if (m.loserNextMatchId && m.loserNextMatchSlot && num) {
      feederLabelMap.set(`${m.loserNextMatchId}:${m.loserNextMatchSlot}`, `Kalah M#${num}`);
    }
  }

  if (allRelevantMatches.length > 0) {
    const scheduledDayCount = dayGroups.filter((g) => !g.isUnscheduled).length;
    const sectionBadgeLabel =
      scheduledDayCount > 1
        ? `${allRelevantMatches.length} Partai • ${scheduledDayCount} Hari`
        : `${allRelevantMatches.length} Partai`;

    const drawDayGroupHeader = (
      startY: number,
      dayIndex: number,
      dayLabel: string,
      matchCount: number,
      isUnscheduled: boolean,
      isContinuation = false
    ) => {
      const softTint = mixWithWhite(accentRgb, 0.86);
      doc.setFillColor(softTint[0], softTint[1], softTint[2]);
      doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.setLineWidth(0.32);
      doc.roundedRect(14, startY, 182, 7.4, 1.4, 1.4, 'FD');

      const pillText = isUnscheduled ? 'MENYUSUL' : `HARI ${dayIndex}`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      const pillW = Math.max(17, doc.getTextWidth(pillText) + 5.6);
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(15.4, startY + 1.1, pillW, 5.2, 1.1, 1.1, 'F');
      doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.text(pillText, 15.4 + pillW / 2, startY + 4.6, { align: 'center' });

      const titleStr = isContinuation
        ? `${dayLabel.toUpperCase()} (LANJUTAN)`
        : dayLabel.toUpperCase();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(truncatePdfText(doc, titleStr, 128), 15.4 + pillW + 3.2, startY + 4.9);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(`${matchCount} Partai`, 193, startY + 4.9, { align: 'right' });

      return startY + 8.2;
    };

    const drawScheduleTableHeader = (startY: number) => {
      doc.setFillColor(30, 41, 59);
      doc.roundedRect(14, startY, 182, 7, 1.2, 1.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.4);
      doc.setTextColor(248, 250, 252);

      doc.text('NO', 18.2, startY + 4.6, { align: 'center' });
      doc.text('WAKTU (WIB)', 34.5, startY + 4.6, { align: 'center' });
      doc.text('LAP.', 55, startY + 4.6, { align: 'center' });
      doc.text(
        activeTournaments.length > 1 ? 'KAT. / BABAK' : 'BABAK / FASE',
        78.5,
        startY + 4.6,
        { align: 'center' }
      );
      doc.text('TIM 1', 110, startY + 4.6, { align: 'center' });
      doc.text('SET', 133, startY + 4.6, { align: 'center' });
      doc.text('TIM 2', 156, startY + 4.6, { align: 'center' });
      doc.text('SKOR PER SET', 184, startY + 4.6, { align: 'center' });
      return startY + 7.4;
    };

    doc.addPage();
    drawInteriorPageShell(
      doc,
      settings,
      docMeta,
      'Jadwal & Rekapitulasi Hasil Pertandingan',
      sectionBadgeLabel,
      logos,
      accentRgb
    );

    let rowY = 37;

    dayGroups.forEach((dayGrp) => {
      // Ensure room for Day Header + Table Header + at least 2 rows so Day Header never orphans
      if (rowY + 29 > 278) {
        doc.addPage();
        drawInteriorPageShell(
          doc,
          settings,
          docMeta,
          'Jadwal & Rekapitulasi Hasil Pertandingan (Lanjutan)',
          sectionBadgeLabel,
          logos,
          accentRgb
        );
        rowY = 37;
      }

      rowY = drawDayGroupHeader(
        rowY,
        dayGrp.dayIndex,
        dayGrp.dayLabel,
        dayGrp.items.length,
        dayGrp.isUnscheduled,
        false
      );
      rowY = drawScheduleTableHeader(rowY);

      dayGrp.items.forEach(({ match: m, parsed }, rowIdxInDay) => {
        if (rowY + 7.2 > 278) {
          doc.addPage();
          drawInteriorPageShell(
            doc,
            settings,
            docMeta,
            'Jadwal & Rekapitulasi Hasil Pertandingan (Lanjutan)',
            sectionBadgeLabel,
            logos,
            accentRgb
          );
          rowY = drawDayGroupHeader(
            37,
            dayGrp.dayIndex,
            dayGrp.dayLabel,
            dayGrp.items.length,
            dayGrp.isUnscheduled,
            true
          );
          rowY = drawScheduleTableHeader(rowY);
        }

        const seqNum = matchSeqNum.get(m.id) ?? rowIdxInDay + 1;
        const cat = tournamentById.get(m.tournamentId)!;
        const totalRounds = maxMainRoundByCat.get(m.tournamentId) ?? 1;
        const customPhase =
          m.stageLabel && !m.stageLabel.includes(' vs ')
            ? m.stageLabel.trim()
            : '';
        const basePhase = customPhase || getRoundStageLabel(m, totalRounds);
        const phaseColText =
          activeTournaments.length > 1 ? `${cat.name} • ${basePhase}` : basePhase;

        const stageParts = m.stageLabel?.includes(' vs ')
          ? m.stageLabel.split(' vs ')
          : [null, null];

        const teamA = m.teamAId ? teamById.get(m.teamAId) : undefined;
        const teamB = m.teamBId ? teamById.get(m.teamBId) : undefined;

        const labelA =
          teamA?.name ||
          stageParts[0] ||
          feederLabelMap.get(`${m.id}:A`) ||
          'Menunggu';
        const labelB =
          teamB?.name ||
          stageParts[1] ||
          feederLabelMap.get(`${m.id}:B`) ||
          'Menunggu';

        const isWinnerA = Boolean(m.winnerId && m.teamAId && m.winnerId === m.teamAId);
        const isWinnerB = Boolean(m.winnerId && m.teamBId && m.winnerId === m.teamBId);

        // Alternating clean tint within each day group
        if (m.status === 'live') {
          doc.setFillColor(254, 242, 242);
        } else if (rowIdxInDay % 2 === 1) {
          doc.setFillColor(248, 250, 252);
        } else {
          doc.setFillColor(255, 255, 255);
        }
        doc.rect(14, rowY, 182, 7, 'F');
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.22);
        doc.line(14, rowY + 7, 196, rowY + 7);

        // Match number (#1..#N)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        doc.setTextColor(51, 65, 85);
        doc.text(String(seqNum), 18.2, rowY + 4.6, { align: 'center' });

        // Time (WIB) — clean without redundant date!
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.4);
        doc.setTextColor(30, 41, 59);
        doc.text(
          truncatePdfText(doc, parsed.timeLabel, 23.5),
          34.5,
          rowY + 4.6,
          { align: 'center' }
        );

        // Court
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.3);
        doc.setTextColor(71, 85, 105);
        doc.text(
          truncatePdfText(doc, m.courtName || 'Court 1', 16),
          55,
          rowY + 4.6,
          { align: 'center' }
        );

        // Phase / Stage
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.3);
        doc.setTextColor(30, 41, 59);
        doc.text(
          truncatePdfText(doc, phaseColText, 29),
          78.5,
          rowY + 4.6,
          { align: 'center' }
        );

        // Team A
        doc.setFont(
          'helvetica',
          teamA ? (isWinnerA ? 'bold' : 'normal') : 'italic'
        );
        doc.setFontSize(6.7);
        doc.setTextColor(
          teamA ? (isWinnerA ? 15 : 51) : 148,
          teamA ? (isWinnerA ? 23 : 65) : 163,
          teamA ? (isWinnerA ? 42 : 85) : 184
        );
        doc.text(truncatePdfText(doc, labelA, 31), 110, rowY + 4.6, { align: 'center' });

        // Set Score Pill
        const hasScore = m.status === 'finished' || m.status === 'live';
        const setScoreText = hasScore ? `${m.setsWonA} - ${m.setsWonB}` : 'vs';
        doc.setFillColor(hasScore ? 15 : 241, hasScore ? 23 : 245, hasScore ? 42 : 249);
        doc.roundedRect(127.4, rowY + 1.2, 11.2, 4.6, 1.1, 1.1, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.7);
        doc.setTextColor(hasScore ? 255 : 100, hasScore ? 255 : 116, hasScore ? 255 : 139);
        doc.text(setScoreText, 133, rowY + 4.4, { align: 'center' });

        // Team B
        doc.setFont(
          'helvetica',
          teamB ? (isWinnerB ? 'bold' : 'normal') : 'italic'
        );
        doc.setFontSize(6.7);
        doc.setTextColor(
          teamB ? (isWinnerB ? 15 : 51) : 148,
          teamB ? (isWinnerB ? 23 : 65) : 163,
          teamB ? (isWinnerB ? 24 : 85) : 184
        );
        doc.text(truncatePdfText(doc, labelB, 31), 156, rowY + 4.6, { align: 'center' });

        // Set-by-set points (only played non-zero sets for scheduled/live)
        const playedSets = (m.sets ?? []).filter(
          (s) => s.scoreA > 0 || s.scoreB > 0 || s.isFinished
        );
        const setDetails =
          playedSets.length > 0
            ? playedSets.map((s) => `${s.scoreA}-${s.scoreB}`).join(', ')
            : m.status === 'live'
              ? 'LIVE'
              : '-';
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.3);
        doc.setTextColor(71, 85, 105);
        doc.text(truncatePdfText(doc, setDetails, 23), 184, rowY + 4.6, {
          align: 'center',
        });

        rowY += 7;
      });

      rowY += 4.4;
    });
  }

  // =========================================================================
  // SECTION 3: MAIN KNOCKOUT BRACKET TREE PER CATEGORY (STOPS CLEANLY HERE)
  // =========================================================================
  for (const tournament of activeTournaments) {
    const mainMatches = overview.matches
      .filter((m) => m.tournamentId === tournament.id && m.bracketType === 'main')
      .sort((a, b) => a.round - b.round || a.matchIndex - b.matchIndex);

    if (mainMatches.length === 0) continue;

    const thirdPlaceMatch = overview.matches.find(
      (m) => m.tournamentId === tournament.id && m.bracketType === 'third_place'
    );

    const rounds = Array.from(new Set(mainMatches.map((m) => m.round))).sort(
      (a, b) => a - b
    );
    const totalRounds = Math.max(...rounds);
    const r1Count = mainMatches.filter((m) => m.round === rounds[0]).length;

    doc.addPage();
    drawInteriorPageShell(
      doc,
      settings,
      docMeta,
      `Bagan Babak Utama • ${tournament.name}`,
      `Best of ${tournament.bestOf}`,
      logos,
      accentRgb
    );

    const treeLeft = 14;
    const treeRight = 196;
    const treeWidth = treeRight - treeLeft;
    const colCount = rounds.length;
    const colGap = colCount > 1 ? Math.min(10, 28 / colCount) : 0;
    const boxW = Math.min(54, (treeWidth - colGap * (colCount - 1)) / colCount);
    const actualSpan = boxW * colCount + colGap * (colCount - 1);
    const startX = treeLeft + (treeWidth - actualSpan) / 2;

    const treeTop = 44;
    const treeBottom = thirdPlaceMatch && r1Count <= 4 ? 236 : 268;
    const availH = treeBottom - treeTop;

    const boxH = r1Count >= 8 ? 20.5 : r1Count >= 4 ? 26 : 30;

    // Store center-Y of every match box so Round r+1 centers strictly between its 2 children
    const centerYByRoundIdx = new Map<string, number>();

    rounds.forEach((rNum, colIdx) => {
      const colX = startX + colIdx * (boxW + colGap);
      const roundMatches = mainMatches
        .filter((m) => m.round === rNum)
        .sort((a, b) => a.matchIndex - b.matchIndex);

      // Column Round Title Pill
      const stageHeader = formatInternationalStageLabel(
        { round: rNum, bracketType: 'main' },
        totalRounds,
        { uppercase: true }
      );

      doc.setFillColor(241, 245, 249);
      doc.roundedRect(colX, 36, boxW, 5.8, 1.2, 1.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(30, 41, 59);
      doc.text(stageHeader, colX + boxW / 2, 40, { align: 'center' });

      const slotStep = availH / Math.max(1, roundMatches.length);

      roundMatches.forEach((m, mIdx) => {
        let cy: number;
        if (colIdx === 0) {
          cy = treeTop + slotStep * (mIdx + 0.5);
        } else {
          const prevRound = rounds[colIdx - 1]!;
          const c1 = centerYByRoundIdx.get(`${prevRound}:${mIdx * 2}`);
          const c2 = centerYByRoundIdx.get(`${prevRound}:${mIdx * 2 + 1}`);
          cy =
            c1 !== undefined && c2 !== undefined
              ? (c1 + c2) / 2
              : treeTop + slotStep * (mIdx + 0.5);

          // Draw crisp orthogonal connector lines from children -> parent
          const prevXRight = startX + (colIdx - 1) * (boxW + colGap) + boxW;
          const midX = prevXRight + colGap / 2;
          doc.setDrawColor(148, 163, 184);
          doc.setLineWidth(0.38);
          if (c1 !== undefined && c2 !== undefined) {
            doc.line(prevXRight, c1, midX, c1);
            doc.line(prevXRight, c2, midX, c2);
            doc.line(midX, c1, midX, c2);
            doc.line(midX, cy, colX, cy);
          }
        }

        centerYByRoundIdx.set(`${rNum}:${mIdx}`, cy);
        drawBracketMatchCardPdf(
          doc,
          m,
          colX,
          cy - boxH / 2,
          boxW,
          boxH,
          teamById,
          matchSeqNum,
          feederLabelMap,
          accentRgb
        );
      });
    });

    // Draw Perebutan Juara 3/4 Box at Bottom-Right (matching POPDA Bulletin layout!)
    if (thirdPlaceMatch) {
      const tpW = Math.max(boxW, 50);
      const tpH = 23;
      const tpX = 196 - tpW;
      const tpY = 250;

      doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.roundedRect(tpX, tpY - 6.2, tpW, 5.4, 1.2, 1.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.6);
      doc.setTextColor(15, 23, 42);
      doc.text('3RD PLACE MATCH', tpX + tpW / 2, tpY - 2.4, {
        align: 'center',
      });

      drawBracketMatchCardPdf(
        doc,
        thirdPlaceMatch,
        tpX,
        tpY,
        tpW,
        tpH,
        teamById,
        matchSeqNum,
        feederLabelMap,
        accentRgb
      );
    }
  }

  stampAllPageFooters(doc, settings, docMeta);

  const fileSlug = slugifyFilename(
    `${docMeta.bulletinNumber || 'buletin'}-${settings.eventName}`
  );
  doc.save(`${fileSlug}.pdf`);
}

function drawBracketMatchCardPdf(
  doc: jsPDF,
  m: Match,
  x: number,
  y: number,
  w: number,
  h: number,
  teamById: Map<number, Team>,
  matchSeqNum: Map<number, number>,
  feederLabelMap: Map<string, string>,
  accentRgb: RgbTuple
) {
  const headerH = 4.4;
  const slotH = (h - headerH) / 2;

  // Outer card frame
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.32);
  doc.roundedRect(x, y, w, h, 1.6, 1.6, 'FD');

  // Top match strip
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(x, y, w, headerH, 1.4, 1.4, 'F');
  doc.rect(x, y + 2, w, headerH - 2, 'F');

  const mNum = matchSeqNum.get(m.id);
  const stripLeft = m.status === 'bye' ? 'BYE' : mNum ? `M#${mNum}` : `R${m.round}`;
  const compactSched = parseScheduleDayAndTime(m.scheduledAt).compactLabel;
  const stripRight = compactSched || m.scheduledAt || m.courtName || '';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.4);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.text(stripLeft, x + 2, y + 3.1);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(truncatePdfText(doc, stripRight, w - 13), x + w - 2, y + 3.1, {
    align: 'right',
  });

  const stageParts = m.stageLabel?.includes(' vs ')
    ? m.stageLabel.split(' vs ')
    : [null, null];

  const renderSlot = (side: 'A' | 'B', slotY: number) => {
    const teamId = side === 'A' ? m.teamAId : m.teamBId;
    const team = teamId ? teamById.get(teamId) : undefined;
    const isWinner = Boolean(m.winnerId && teamId && m.winnerId === teamId);
    const setsWon = side === 'A' ? m.setsWonA : m.setsWonB;

    if (isWinner) {
      const winTint = mixWithWhite(accentRgb, 0.86);
      doc.setFillColor(winTint[0], winTint[1], winTint[2]);
      doc.rect(x + 0.3, slotY, w - 0.6, slotH - 0.2, 'F');
    }

    const fallbackLabel =
      (side === 'A' ? stageParts[0] : stageParts[1]) ||
      feederLabelMap.get(`${m.id}:${side}`) ||
      (m.status === 'bye' ? 'BYE' : 'TBD');

    const displayName = team ? team.name : fallbackLabel;
    const textMidY = slotY + slotH / 2 + 1.4;

    // Color dot
    const dotRgb = team ? hexToRgb(team.color, accentRgb) : ([203, 213, 225] as RgbTuple);
    doc.setFillColor(dotRgb[0], dotRgb[1], dotRgb[2]);
    doc.circle(x + 2.8, textMidY - 1.1, 1, 'F');

    // Team name
    doc.setFont(
      'helvetica',
      team ? (isWinner ? 'bold' : 'normal') : 'italic'
    );
    doc.setFontSize(rFontSizeForWidth(w));
    doc.setTextColor(
      team ? (isWinner ? 15 : 30) : 148,
      team ? (isWinner ? 23 : 41) : 163,
      team ? (isWinner ? 42 : 59) : 184
    );
    doc.text(truncatePdfText(doc, displayName, w - 12.5), x + 5, textMidY);

    // Score box on right
    if (m.status === 'finished' || m.status === 'live') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(isWinner ? 15 : 100, isWinner ? 23 : 116, isWinner ? 42 : 139);
      doc.text(String(setsWon), x + w - 2.4, textMidY, { align: 'right' });
    }
  };

  const slotAY = y + headerH;
  const slotBY = slotAY + slotH;
  renderSlot('A', slotAY);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.22);
  doc.line(x + 1, slotBY, x + w - 1, slotBY);

  renderSlot('B', slotBY);
}

function rFontSizeForWidth(w: number): number {
  if (w <= 38) return 5.8;
  if (w <= 46) return 6.2;
  return 6.6;
}

export interface MatchSummaryContext {
  settings: SiteSettings;
  tournament?: Tournament;
  teamA?: Team;
  teamB?: Team;
  totalMainRounds?: number;
  docSettingsOverride?: OfficialDocSettings;
}

/**
 * Generates and downloads a 1-Page A4 Official Match Summary PDF (Berita Acara Hasil Pertandingan)
 * with set-by-set points, timeouts, substitutions, point ratio, and referee/captain signature blocks.
 */
export async function downloadMatchSummaryPdf(
  match: Match,
  ctx: MatchSummaryContext
): Promise<void> {
  const { settings, tournament, teamA, teamB } = ctx;
  const savedDocMeta = parseOfficialDocSettings(settings.docSettingsJson);
  const docMeta: OfficialDocSettings = {
    ...savedDocMeta,
    ...ctx.docSettingsOverride,
  };
  const accentRgb = hexToRgb(settings.accentColor, [224, 157, 23]);

  const [mainLogo, organizerLogo, watermarkLogo, crestA, crestB] = await Promise.all([
    loadRasterAsset(settings.logoUrl || '/brand/svc-crest-color.svg', {
      maxDim: 360,
    }),
    loadRasterAsset(settings.organizerLogoUrl, { maxDim: 300 }),
    loadRasterAsset(settings.logoUrl || '/brand/svc-crest-color.svg', {
      maxDim: 340,
      opacity: 0.05,
    }),
    loadRasterAsset(teamA?.logoUrl, { maxDim: 240 }),
    loadRasterAsset(teamB?.logoUrl, { maxDim: 240 }),
  ]);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  if (watermarkLogo) {
    addContainedImage(doc, watermarkLogo, 55, 102, 100, 100);
  }

  // Top Championship Accent Bar
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 0, 210, 3, 'F');

  // Official Letterhead (aspect-preserved)
  if (organizerLogo) {
    const orgW = Math.min(28, Math.max(16, 16 * organizerLogo.aspect));
    addContainedImage(doc, organizerLogo, 15, 8.8, orgW, 16.2);
  }
  if (mainLogo) {
    const mainW = Math.min(28, Math.max(16, 16.5 * mainLogo.aspect));
    addContainedImage(doc, mainLogo, 195 - mainW, 8.5, mainW, 16.8);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    truncatePdfText(doc, settings.eventName.toUpperCase(), 138),
    105,
    14.5,
    { align: 'center' }
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    truncatePdfText(doc, settings.eventSubtitle || settings.eventMeta, 142),
    105,
    19.8,
    { align: 'center' }
  );

  doc.setFontSize(7.8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    truncatePdfText(doc, docMeta.venueName || settings.eventMeta || '-', 142),
    105,
    24.4,
    { align: 'center' }
  );

  // Double Official Rule Line
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.65);
  doc.line(14, 28.5, 196, 28.5);
  doc.setLineWidth(0.22);
  doc.line(14, 29.8, 196, 29.8);

  // Document Title Banner
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(14, 34, 182, 10.5, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text('BERITA ACARA HASIL PERTANDINGAN (OFFICIAL MATCH SUMMARY)', 105, 40.7, {
    align: 'center',
  });

  // Metadata Box
  const phaseLabel = getRoundStageLabel(match, ctx.totalMainRounds ?? 3);
  const effBestOf = match.bestOf ?? tournament?.bestOf ?? 3;
  const effRegPts = match.regularSetPoints ?? tournament?.regularSetPoints ?? 25;
  const effDecPts = match.decidingSetPoints ?? tournament?.decidingSetPoints ?? 15;
  const statusLabel =
    match.status === 'finished'
      ? 'SELESAI (RESMI)'
      : match.status === 'live'
        ? 'SEDANG BERLANGSUNG'
        : 'TERJADWAL';

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.32);
  doc.roundedRect(14, 48.5, 182, 22, 2, 2, 'FD');

  const drawMetaPair = (label: string, val: string, mx: number, my: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text(label, mx, my);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(truncatePdfText(doc, val, 58), mx + 26, my);
  };

  drawMetaPair('Kategori', tournament?.name || '-', 18, 55);
  drawMetaPair('Babak / Fase', phaseLabel, 18, 61);
  drawMetaPair('Format Set', `Best of ${effBestOf} (${effRegPts}/${effDecPts} Poin)`, 18, 67);

  drawMetaPair('Lapangan', match.courtName || 'Lapangan 1', 108, 55);
  drawMetaPair('Jadwal / Waktu', match.scheduledAt || formatIndonesianDateNow(), 108, 61);
  drawMetaPair('Status Partai', statusLabel, 108, 67);

  // Main Scoreboard Showcase Card
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.4);
  doc.roundedRect(14, 75, 182, 42, 3, 3, 'FD');

  const nameA = teamA?.name || 'Tim A';
  const nameB = teamB?.name || 'Tim B';

  // Team A side
  if (crestA) {
    addContainedImage(doc, crestA, 22, 81, 18, 18);
  } else {
    const rgbA = hexToRgb(teamA?.color, accentRgb);
    doc.setFillColor(rgbA[0], rgbA[1], rgbA[2]);
    doc.roundedRect(22, 81, 18, 18, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text((teamA?.shortCode || 'TIM A').slice(0, 4), 31, 91.5, { align: 'center' });
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(truncatePdfText(doc, nameA, 64), 52, 105, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(truncatePdfText(doc, teamA?.school || '', 64), 52, 110, { align: 'center' });

  // Center Set Score Box
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(84, 81, 42, 20, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text(`${match.setsWonA}  :  ${match.setsWonB}`, 105, 94.2, { align: 'center' });

  const winnerTeam =
    match.winnerId && teamA && match.winnerId === teamA.id
      ? teamA
      : match.winnerId && teamB && match.winnerId === teamB.id
        ? teamB
        : null;

  if (winnerTeam) {
    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.roundedRect(72, 104.5, 66, 6.5, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(15, 23, 42);
    doc.text(
      truncatePdfText(doc, `PEMENANG: ${winnerTeam.name.toUpperCase()}`, 62),
      105,
      109,
      { align: 'center' }
    );
  }

  // Team B side
  if (crestB) {
    addContainedImage(doc, crestB, 170, 81, 18, 18);
  } else {
    const rgbB = hexToRgb(teamB?.color, [59, 130, 246]);
    doc.setFillColor(rgbB[0], rgbB[1], rgbB[2]);
    doc.roundedRect(170, 81, 18, 18, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text((teamB?.shortCode || 'TIM B').slice(0, 4), 179, 91.5, { align: 'center' });
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(truncatePdfText(doc, nameB, 64), 158, 105, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(truncatePdfText(doc, teamB?.school || '', 64), 158, 110, { align: 'center' });

  // =========================================================================
  // SET-BY-SET BREAKDOWN TABLE (WITH TIMEOUTS & SUBSTITUTIONS)
  // =========================================================================
  let tableY = 123;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(15, 23, 42);
  doc.text('RINCIAN SKOR, TIME-OUT & SUBSTITUSI PER SET', 14, tableY);
  tableY += 3.5;

  // Table Header
  doc.setFillColor(30, 41, 59);
  doc.roundedRect(14, tableY, 182, 7.8, 1.4, 1.4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(248, 250, 252);

  doc.text('SET', 22, tableY + 5.1, { align: 'center' });
  doc.text(truncatePdfText(doc, nameA.toUpperCase(), 32), 48, tableY + 5.1, {
    align: 'center',
  });
  doc.text(truncatePdfText(doc, nameB.toUpperCase(), 32), 82, tableY + 5.1, {
    align: 'center',
  });
  doc.text('T/O (A - B)', 113, tableY + 5.1, { align: 'center' });
  doc.text('SUB (A - B)', 136, tableY + 5.1, { align: 'center' });
  doc.text('SELISIH', 156, tableY + 5.1, { align: 'center' });
  doc.text('PEMENANG SET', 179, tableY + 5.1, { align: 'center' });

  tableY += 8.2;

  const sets = match.sets ?? [];
  let totalPtsA = 0;
  let totalPtsB = 0;
  let totalToA = 0;
  let totalToB = 0;
  let totalSubA = 0;
  let totalSubB = 0;

  const maxRows = Math.max(effBestOf, sets.length);
  for (let i = 0; i < maxRows; i++) {
    const s = sets[i];
    doc.setFillColor(i % 2 === 0 ? 255 : 248, i % 2 === 0 ? 255 : 250, i % 2 === 0 ? 255 : 252);
    doc.rect(14, tableY, 182, 7.8, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(14, tableY + 7.8, 196, tableY + 7.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(15, 23, 42);
    doc.text(`Set ${i + 1}`, 22, tableY + 5.1, { align: 'center' });

    if (s) {
      totalPtsA += s.scoreA;
      totalPtsB += s.scoreB;
      totalToA += s.timeoutsA ?? 0;
      totalToB += s.timeoutsB ?? 0;
      totalSubA += s.subsA ?? 0;
      totalSubB += s.subsB ?? 0;

      const winA = s.scoreA > s.scoreB && (s.isFinished || match.status === 'finished');
      const winB = s.scoreB > s.scoreA && (s.isFinished || match.status === 'finished');

      doc.setFont('helvetica', winA ? 'bold' : 'normal');
      doc.text(String(s.scoreA), 48, tableY + 5.1, { align: 'center' });

      doc.setFont('helvetica', winB ? 'bold' : 'normal');
      doc.text(String(s.scoreB), 82, tableY + 5.1, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`${s.timeoutsA ?? 0} - ${s.timeoutsB ?? 0}`, 113, tableY + 5.1, {
        align: 'center',
      });
      doc.text(`${s.subsA ?? 0} - ${s.subsB ?? 0}`, 136, tableY + 5.1, {
        align: 'center',
      });
      doc.text(`+${Math.abs(s.scoreA - s.scoreB)}`, 156, tableY + 5.1, {
        align: 'center',
      });

      const setWinnerText = winA
        ? teamA?.shortCode || nameA
        : winB
          ? teamB?.shortCode || nameB
          : s.isFinished
            ? '-'
            : 'Berjalan';
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(truncatePdfText(doc, setWinnerText, 28), 179, tableY + 5.1, {
        align: 'center',
      });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('-', 48, tableY + 5.1, { align: 'center' });
      doc.text('-', 82, tableY + 5.1, { align: 'center' });
      doc.text('-', 113, tableY + 5.1, { align: 'center' });
      doc.text('-', 136, tableY + 5.1, { align: 'center' });
      doc.text('-', 156, tableY + 5.1, { align: 'center' });
      doc.text('Tidak Dimainkan', 179, tableY + 5.1, { align: 'center' });
    }

    tableY += 7.8;
  }

  // Totals Footer Row
  const softAccent = mixWithWhite(accentRgb, 0.88);
  doc.setFillColor(softAccent[0], softAccent[1], softAccent[2]);
  doc.rect(14, tableY, 182, 8.2, 'F');
  doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.line(14, tableY + 8.2, 196, tableY + 8.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(15, 23, 42);
  doc.text('TOTAL', 22, tableY + 5.4, { align: 'center' });
  doc.text(String(totalPtsA), 48, tableY + 5.4, { align: 'center' });
  doc.text(String(totalPtsB), 82, tableY + 5.4, { align: 'center' });
  doc.text(`${totalToA} - ${totalToB}`, 113, tableY + 5.4, { align: 'center' });
  doc.text(`${totalSubA} - ${totalSubB}`, 136, tableY + 5.4, { align: 'center' });

  const pointRatio =
    totalPtsB > 0
      ? (totalPtsA / totalPtsB).toFixed(2)
      : totalPtsA > 0
        ? `${totalPtsA}.00`
        : '0.00';
  doc.text(`Rasio: ${pointRatio}`, 168, tableY + 5.4, { align: 'center' });

  // =========================================================================
  // 4-COLUMN OFFICIAL SIGNATURE BLOCK
  // =========================================================================
  const sigTopY = 228;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(15, 23, 42);
  doc.text('PENGESAHAN PERANGKAT PERTANDINGAN & KAPTEN TIM', 14, sigTopY);

  const sigCols = [
    {
      role: 'WASIT I (UTAMA)',
      name: docMeta.referee1Default?.trim() || '( ............................ )',
    },
    {
      role: 'WASIT II / SCORER',
      name: docMeta.referee2Default?.trim() || '( ............................ )',
    },
    {
      role: `KAPTEN ${teamA?.shortCode || 'TIM A'}`,
      name: '( ............................ )',
    },
    {
      role: `KAPTEN ${teamB?.shortCode || 'TIM B'}`,
      name: '( ............................ )',
    },
  ];

  const sigBoxW = 42.5;
  const sigGap = 4;
  sigCols.forEach((sc, idx) => {
    const sx = 14 + idx * (sigBoxW + sigGap);
    const sy = sigTopY + 4;

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(sx, sy, sigBoxW, 38, 2, 2, 'FD');

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(sx, sy, sigBoxW, 6.8, 1.8, 1.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(51, 65, 85);
    doc.text(truncatePdfText(doc, sc.role, sigBoxW - 3), sx + sigBoxW / 2, sy + 4.5, {
      align: 'center',
    });

    // Signature line
    doc.setDrawColor(148, 163, 184);
    doc.line(sx + 5, sy + 29.5, sx + sigBoxW - 5, sy + 29.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59);
    doc.text(truncatePdfText(doc, sc.name, sigBoxW - 4), sx + sigBoxW / 2, sy + 34.5, {
      align: 'center',
    });
  });

  // Bottom Page Footer
  doc.setDrawColor(226, 232, 240);
  doc.line(14, 284, 196, 284);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Dicetak otomatis melalui Sistem Resmi ${settings.eventName} • ${formatIndonesianDateNow()}`,
    14,
    289.2
  );
  doc.setFont('helvetica', 'bold');
  doc.text('Halaman 1 / 1', 196, 289.2, { align: 'right' });

  const matchSlug = slugifyFilename(
    `berita-acara-${tournament?.name || 'match'}-${nameA}-vs-${nameB}`
  );
  doc.save(`${matchSlug}.pdf`);
}

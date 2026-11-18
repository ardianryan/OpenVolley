import { jsPDF } from 'jspdf';
import { computePoolStandings } from '../../shared/pool';
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

const rasterCache = new Map<string, string | null>();

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

async function loadRasterPngDataUrl(
  url?: string | null,
  options?: { maxDim?: number; opacity?: number; mode?: 'contain' | 'cover'; aspect?: number }
): Promise<string | null> {
  const safeUrl = toCorsSafeAssetUrl(url);
  if (!safeUrl || typeof document === 'undefined') return null;
  const maxDim = options?.maxDim ?? 320;
  const opacity = options?.opacity ?? 1;
  const mode = options?.mode ?? 'contain';
  const aspect = options?.aspect ?? 1;
  const cacheKey = `${safeUrl}|${maxDim}|${opacity}|${mode}|${aspect}`;

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

        const dataUrl = canvas.toDataURL('image/png');
        if (rasterCache.size > 120) rasterCache.clear();
        rasterCache.set(cacheKey, dataUrl);
        resolve(dataUrl);
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
  mainLogo: string | null;
  coBrandLogo: string | null;
  organizerLogo: string | null;
  watermarkLogo: string | null;
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
  // Subtle center watermark
  if (logos.watermarkLogo) {
    doc.addImage(logos.watermarkLogo, 'PNG', 55, 98, 100, 100, undefined, 'FAST');
  }

  // Top accent bar
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 0, 210, 2.4, 'F');

  // Header brand logos & title
  let textLeftX = 14;
  if (logos.organizerLogo) {
    doc.addImage(logos.organizerLogo, 'PNG', 14, 7.5, 10, 10, undefined, 'FAST');
    textLeftX = 26.5;
  }
  if (logos.mainLogo) {
    doc.addImage(logos.mainLogo, 'PNG', 186, 7, 10.5, 11, undefined, 'FAST');
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

  // Preload brand & team logos concurrently
  const [mainLogo, coBrandLogo, organizerLogo, watermarkLogo, customCover] =
    await Promise.all([
      loadRasterPngDataUrl(settings.logoUrl || '/brand/svc-crest-color.svg', {
        maxDim: 420,
      }),
      loadRasterPngDataUrl(settings.coBrandLogoUrl, { maxDim: 300 }),
      loadRasterPngDataUrl(settings.organizerLogoUrl, { maxDim: 300 }),
      loadRasterPngDataUrl(settings.logoUrl || '/brand/svc-crest-color.svg', {
        maxDim: 360,
        opacity: 0.055,
      }),
      docMeta.coverImageUrl
        ? loadRasterPngDataUrl(docMeta.coverImageUrl, {
            maxDim: 1600,
            mode: 'cover',
            aspect: 210 / 297,
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
  const teamLogoMap = new Map<number, string>();
  await Promise.all(
    overview.teams
      .filter((tm) => relevantTeamIds.has(tm.id) && tm.logoUrl)
      .map(async (tm) => {
        const uri = await loadRasterPngDataUrl(tm.logoUrl, { maxDim: 180 });
        if (uri) teamLogoMap.set(tm.id, uri);
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
    doc.addImage(customCover, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
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

    // Accent geometric stripes
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(1.2);
    doc.line(18, 52, 62, 52);

    // Top Partner & Organizer Logo Badges
    let badgeX = 18;
    for (const logoUri of [organizerLogo, coBrandLogo].filter(Boolean) as string[]) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(badgeX, 18, 18, 18, 3.5, 3.5, 'F');
      doc.addImage(logoUri, 'PNG', badgeX + 2, 20, 14, 14, undefined, 'FAST');
      badgeX += 22;
    }

    // Center-Right Showcase Crest Card
    doc.setFillColor(17, 24, 39);
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.7);
    doc.roundedRect(55, 58, 100, 96, 8, 8, 'FD');

    if (mainLogo) {
      doc.addImage(mainLogo, 'PNG', 67, 66, 76, 80, undefined, 'FAST');
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

          const crestUri = teamLogoMap.get(tm.id);
          if (crestUri) {
            doc.addImage(
              crestUri,
              'PNG',
              cardX + 5.8,
              cursorY + 3.8,
              11.5,
              11.5,
              undefined,
              'FAST'
            );
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
  // SECTION 2B: SCHEDULE & RESULTS TABLE
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

  // Build sequential match numbering per tournament + global schedule list
  const allRelevantMatches = overview.matches
    .filter((m) => tournamentById.has(m.tournamentId) && m.status !== 'bye')
    .sort((a, b) => {
      // Pool matches first, then main rounds ascending, then third_place before final
      const typeRank = (m: Match) =>
        m.bracketType === 'pool' ? 0 : m.bracketType === 'third_place' ? 1 : 1;
      if (typeRank(a) !== typeRank(b)) return typeRank(a) - typeRank(b);
      if (a.round !== b.round) return a.round - b.round;
      if (a.bracketType !== b.bracketType) {
        return a.bracketType === 'third_place' ? -1 : 1;
      }
      if (a.tournamentId !== b.tournamentId) return a.tournamentId - b.tournamentId;
      return a.matchIndex - b.matchIndex;
    });

  // Map matchId -> display Match Number (#1..#N) for advancement placeholders
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
    const drawScheduleTableHeader = (startY: number) => {
      doc.setFillColor(30, 41, 59);
      doc.roundedRect(14, startY, 182, 7.2, 1.2, 1.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.6);
      doc.setTextColor(248, 250, 252);

      doc.text('NO', 18.5, startY + 4.7, { align: 'center' });
      doc.text('WAKTU', 32, startY + 4.7, { align: 'center' });
      doc.text('LAPANGAN', 52, startY + 4.7, { align: 'center' });
      doc.text('KAT. / FASE', 75, startY + 4.7, { align: 'center' });
      doc.text('TIM 1', 105, startY + 4.7, { align: 'center' });
      doc.text('SET', 129, startY + 4.7, { align: 'center' });
      doc.text('TIM 2', 153, startY + 4.7, { align: 'center' });
      doc.text('SKOR PER SET', 182, startY + 4.7, { align: 'center' });
      return startY + 7.6;
    };

    doc.addPage();
    drawInteriorPageShell(
      doc,
      settings,
      docMeta,
      'Jadwal & Rekapitulasi Hasil Pertandingan',
      `${allRelevantMatches.length} Partai`,
      logos,
      accentRgb
    );

    let rowY = drawScheduleTableHeader(37);

    allRelevantMatches.forEach((m, idx) => {
      if (rowY + 7.4 > 278) {
        doc.addPage();
        drawInteriorPageShell(
          doc,
          settings,
          docMeta,
          'Jadwal & Rekapitulasi Hasil Pertandingan (Lanjutan)',
          `${allRelevantMatches.length} Partai`,
          logos,
          accentRgb
        );
        rowY = drawScheduleTableHeader(37);
      }

      const cat = tournamentById.get(m.tournamentId)!;
      const totalRounds = maxMainRoundByCat.get(m.tournamentId) ?? 1;
      const phaseName = getRoundStageLabel(m, totalRounds);

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

      // Alternating clean tint
      if (m.status === 'live') {
        doc.setFillColor(254, 242, 242);
      } else if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.rect(14, rowY, 182, 7.2, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.22);
      doc.line(14, rowY + 7.2, 196, rowY + 7.2);

      // Match number
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      doc.text(String(idx + 1), 18.5, rowY + 4.7, { align: 'center' });

      // Scheduled Time
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.6);
      doc.setTextColor(71, 85, 105);
      doc.text(
        truncatePdfText(doc, m.scheduledAt || '-', 17),
        32,
        rowY + 4.7,
        { align: 'center' }
      );

      // Court
      doc.text(
        truncatePdfText(doc, m.courtName || 'Court 1', 19),
        52,
        rowY + 4.7,
        { align: 'center' }
      );

      // Category / Phase
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.4);
      doc.setTextColor(30, 41, 59);
      doc.text(
        truncatePdfText(doc, `${cat.name} • ${phaseName}`, 26),
        75,
        rowY + 4.7,
        { align: 'center' }
      );

      // Team A
      doc.setFont(
        'helvetica',
        teamA ? (isWinnerA ? 'bold' : 'normal') : 'italic'
      );
      doc.setFontSize(6.8);
      doc.setTextColor(
        teamA ? (isWinnerA ? 15 : 51) : 148,
        teamA ? (isWinnerA ? 23 : 65) : 163,
        teamA ? (isWinnerA ? 42 : 85) : 184
      );
      doc.text(truncatePdfText(doc, labelA, 30), 105, rowY + 4.7, { align: 'center' });

      // Set Score Pill
      const hasScore = m.status === 'finished' || m.status === 'live';
      const setScoreText = hasScore ? `${m.setsWonA} - ${m.setsWonB}` : 'vs';
      doc.setFillColor(hasScore ? 15 : 241, hasScore ? 23 : 245, hasScore ? 42 : 249);
      doc.roundedRect(123, rowY + 1.3, 12, 4.6, 1.1, 1.1, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(hasScore ? 255 : 100, hasScore ? 255 : 116, hasScore ? 255 : 139);
      doc.text(setScoreText, 129, rowY + 4.5, { align: 'center' });

      // Team B
      doc.setFont(
        'helvetica',
        teamB ? (isWinnerB ? 'bold' : 'normal') : 'italic'
      );
      doc.setFontSize(6.8);
      doc.setTextColor(
        teamB ? (isWinnerB ? 15 : 51) : 148,
        teamB ? (isWinnerB ? 23 : 65) : 163,
        teamB ? (isWinnerB ? 24 : 85) : 184
      );
      doc.text(truncatePdfText(doc, labelB, 30), 153, rowY + 4.7, { align: 'center' });

      // Set-by-set points
      const setDetails =
        m.sets && m.sets.length > 0
          ? m.sets.map((s) => `${s.scoreA}-${s.scoreB}`).join(', ')
          : m.status === 'live'
            ? 'LIVE'
            : '-';
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.4);
      doc.setTextColor(71, 85, 105);
      doc.text(truncatePdfText(doc, setDetails, 26), 182, rowY + 4.7, {
        align: 'center',
      });

      rowY += 7.2;
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
  const stripRight = m.scheduledAt || m.courtName || '';

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
    loadRasterPngDataUrl(settings.logoUrl || '/brand/svc-crest-color.svg', {
      maxDim: 320,
    }),
    loadRasterPngDataUrl(settings.organizerLogoUrl, { maxDim: 260 }),
    loadRasterPngDataUrl(settings.logoUrl || '/brand/svc-crest-color.svg', {
      maxDim: 340,
      opacity: 0.05,
    }),
    loadRasterPngDataUrl(teamA?.logoUrl, { maxDim: 220 }),
    loadRasterPngDataUrl(teamB?.logoUrl, { maxDim: 220 }),
  ]);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  if (watermarkLogo) {
    doc.addImage(watermarkLogo, 'PNG', 55, 102, 100, 100, undefined, 'FAST');
  }

  // Top Championship Accent Bar
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 0, 210, 3, 'F');

  // Official Letterhead
  if (organizerLogo) {
    doc.addImage(organizerLogo, 'PNG', 15, 9, 16, 16, undefined, 'FAST');
  }
  if (mainLogo) {
    doc.addImage(mainLogo, 'PNG', 179, 8.5, 16, 17, undefined, 'FAST');
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
    doc.addImage(crestA, 'PNG', 22, 81, 18, 18, undefined, 'FAST');
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
    doc.addImage(crestB, 'PNG', 170, 81, 18, 18, undefined, 'FAST');
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

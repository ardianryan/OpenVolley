const HEIC_FTYP_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
]);

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  const limit = Math.min(bytes.length, end);
  for (let i = start; i < limit; i++) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

/**
 * Detects Apple iPhone HEIC / HEIF images via ISO-BMFF `ftyp` magic bytes or filename/MIME.
 */
export function isHeicHeaderOrFile(
  bytes: Uint8Array,
  fileName = '',
  mimeType = ''
): boolean {
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.includes('image/heic') || lowerMime.includes('image/heif')) {
    return true;
  }

  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) {
    return true;
  }

  // ISO Base Media File Format: [4..8] === "ftyp", [8..12] === major brand
  if (bytes.length >= 12 && readAscii(bytes, 4, 8) === 'ftyp') {
    const brand = readAscii(bytes, 8, 12).toLowerCase();
    if (HEIC_FTYP_BRANDS.has(brand)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects Apple QuickTime `.MOV` containers via `ftypqt  ` / `moov` magic bytes or filename/MIME.
 */
export function isQuickTimeMovHeaderOrFile(
  bytes: Uint8Array,
  fileName = '',
  mimeType = ''
): boolean {
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime === 'video/quicktime') return true;

  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.mov') || lowerName.endsWith('.qt')) return true;

  if (bytes.length >= 12 && readAscii(bytes, 4, 8) === 'ftyp') {
    const brand = readAscii(bytes, 8, 12);
    if (brand === 'qt  ') return true;
  }

  return false;
}

/**
 * Scales high-megapixel iPhone dimensions (e.g. 48MP 8064x6048) proportionally within `maxDim`.
 */
export function computeScaledDimensions(
  srcW: number,
  srcH: number,
  maxDim: number
): { width: number; height: number; resized: boolean } {
  const safeW = Math.max(1, Math.round(srcW));
  const safeH = Math.max(1, Math.round(srcH));
  const longest = Math.max(safeW, safeH);

  if (longest <= maxDim) {
    return { width: safeW, height: safeH, resized: false };
  }

  const scale = maxDim / longest;
  return {
    width: Math.max(2, Math.round(safeW * scale)),
    height: Math.max(2, Math.round(safeH * scale)),
    resized: true,
  };
}

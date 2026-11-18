const REGION_SUFFIXES = [
  'SIDOARJO',
  'MOJOKERTO',
  'JOMBANG',
  'SURABAYA',
  'GRESIK',
  'PASURUAN',
  'MALANG',
  'LAMONGAN',
  'KEDIRI',
  'NGANJUK',
  'TUBAN',
  'BOJONEGORO',
  'PROBOLINGGO',
  'BLITAR',
  'MADIUN',
  'TULUNGAGUNG',
  'BATU',
];

/**
 * Smart-splices Indonesian school/team names so regional labels ("KOTA MOJOKERTO",
 * "KAB. SIDOARJO", "SIDOARJO", etc.) move cleanly onto a second line, allowing
 * the main school name to render much larger without awkward truncation.
 */
export function splitTeamRegionName(
  rawName: string,
  fallbackSchool?: string | null
): { primary: string; region: string } {
  const clean = rawName.trim().replace(/\s+/g, ' ');
  if (!clean) {
    return {
      primary: 'TIM',
      region: fallbackSchool?.trim().toUpperCase() || '',
    };
  }

  // 1. Explicit "KOTA <DAERAH>" or "KAB. / KABUPATEN <DAERAH>" at the end
  const kotaKabMatch = clean.match(
    /^(.+?)\s+((?:KOTA|KAB\.?|KABUPATEN)\s+.+)$/i
  );
  if (kotaKabMatch && kotaKabMatch[1].trim().length >= 3) {
    return {
      primary: kotaKabMatch[1].trim().toUpperCase(),
      region: kotaKabMatch[2].trim().toUpperCase(),
    };
  }

  // 2. Known trailing region/city word (e.g. "SMPN 2 Candi Sidoarjo" -> "SMPN 2 CANDI" + "SIDOARJO")
  const words = clean.split(' ');
  if (words.length >= 3) {
    const lastUpper = words[words.length - 1].toUpperCase();
    if (REGION_SUFFIXES.includes(lastUpper)) {
      return {
        primary: words.slice(0, -1).join(' ').toUpperCase(),
        region: lastUpper,
      };
    }
  }

  // 3. Fallback: if name is long (> 15 chars) and has multiple words, split near the end
  if (clean.length > 15 && words.length >= 3 && !fallbackSchool) {
    return {
      primary: words.slice(0, -1).join(' ').toUpperCase(),
      region: words[words.length - 1].toUpperCase(),
    };
  }

  return {
    primary: clean.toUpperCase(),
    region: fallbackSchool?.trim().toUpperCase() || '',
  };
}

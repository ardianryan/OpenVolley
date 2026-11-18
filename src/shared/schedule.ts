export interface ParsedScheduleInfo {
  raw: string;
  dayLabel: string;
  dayKey: string;
  dateSortKey: number;
  startMinutes: number;
  timeLabel: string;
  compactLabel: string;
  isUnscheduled: boolean;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  januari: 1,
  january: 1,
  feb: 2,
  februari: 2,
  february: 2,
  mar: 3,
  maret: 3,
  march: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  agu: 8,
  ags: 8,
  agustus: 8,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  oct: 10,
  october: 10,
  nov: 11,
  nop: 11,
  november: 11,
  des: 12,
  desember: 12,
  dec: 12,
  december: 12,
};

const WEEKDAY_ORDER: Record<string, { order: number; short: string }> = {
  senin: { order: 1, short: 'Sen' },
  monday: { order: 1, short: 'Mon' },
  selasa: { order: 2, short: 'Sel' },
  tuesday: { order: 2, short: 'Tue' },
  rabu: { order: 3, short: 'Rab' },
  wednesday: { order: 3, short: 'Wed' },
  kamis: { order: 4, short: 'Kam' },
  thursday: { order: 4, short: 'Thu' },
  jumat: { order: 5, short: 'Jum' },
  "jum'at": { order: 5, short: 'Jum' },
  friday: { order: 5, short: 'Fri' },
  sabtu: { order: 6, short: 'Sab' },
  saturday: { order: 6, short: 'Sat' },
  minggu: { order: 7, short: 'Min' },
  ahad: { order: 7, short: 'Min' },
  sunday: { order: 7, short: 'Sun' },
};

const SHORT_MONTH_LABELS = [
  '',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

function normalizeTimeExpression(rawTime: string): {
  timeLabel: string;
  startMinutes: number;
  startShort: string;
} {
  let cleaned = rawTime.trim();
  if (!cleaned) {
    return { timeLabel: '-', startMinutes: 9999, startShort: '' };
  }

  // Fix typo patterns like "16.00.1700" or "16.00.17.00" -> "16.00 - 17.00"
  cleaned = cleaned.replace(
    /\b(\d{1,2})[:.](\d{2})[.\s]+(\d{1,2})[:.]?(\d{2})\b/,
    '$1.$2 - $3.$4'
  );

  // Normalize tight hyphen ranges "13.00-14.00" -> "13.00 - 14.00"
  cleaned = cleaned.replace(
    /\b(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})\b/,
    '$1 - $2'
  );

  const startMatch = cleaned.match(/\b(\d{1,2})[:.](\d{2})\b/);
  let startMinutes = 9999;
  let startShort = '';
  if (startMatch) {
    const hh = Math.min(23, Math.max(0, parseInt(startMatch[1]!, 10)));
    const mm = Math.min(59, Math.max(0, parseInt(startMatch[2]!, 10)));
    startMinutes = hh * 60 + mm;
    startShort = `${String(hh).padStart(2, '0')}.${String(mm).padStart(2, '0')}`;
  }

  const hasTz = /\b(WIB|WITA|WIT|UTC|GMT)\b/i.test(cleaned);
  const timeLabel =
    startMinutes < 9999 && !hasTz ? `${cleaned} WIB` : cleaned;

  return { timeLabel, startMinutes, startShort };
}

function extractDateSortAndKey(dayLabel: string): {
  dayKey: string;
  dateSortKey: number;
  compactDay: string;
} {
  const lower = dayLabel.toLowerCase().trim();
  if (!lower) {
    return {
      dayKey: '__unscheduled__',
      dateSortKey: 99999999,
      compactDay: '',
    };
  }

  let weekdayShort = '';
  let weekdayIdx = 0;
  for (const [wk, meta] of Object.entries(WEEKDAY_ORDER)) {
    if (new RegExp(`\\b${wk}\\b`, 'i').test(lower)) {
      weekdayShort = meta.short;
      weekdayIdx = meta.order;
      break;
    }
  }

  // Match "27 Nov 2026" or "27 November"
  const dmMatch = lower.match(
    /\b(\d{1,2})\s+([a-zA-Z]+)(?:\s+(\d{4}))?\b/
  );
  if (dmMatch) {
    const dayNum = parseInt(dmMatch[1]!, 10);
    const monthName = dmMatch[2]!.toLowerCase();
    const monthNum = MONTH_MAP[monthName];
    const yearNum = dmMatch[3] ? parseInt(dmMatch[3], 10) : 2026;
    if (monthNum && dayNum >= 1 && dayNum <= 31) {
      const dateSortKey = yearNum * 10000 + monthNum * 100 + dayNum;
      const dayKey = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const shortMonth = SHORT_MONTH_LABELS[monthNum] || dmMatch[2]!;
      const compactDay = weekdayShort
        ? `${weekdayShort}, ${dayNum} ${shortMonth}`
        : `${dayNum} ${shortMonth}`;
      return { dayKey, dateSortKey, compactDay };
    }
  }

  // Match ISO "2026-11-27"
  const isoMatch = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1]!, 10);
    const m = parseInt(isoMatch[2]!, 10);
    const d = parseInt(isoMatch[3]!, 10);
    return {
      dayKey: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dateSortKey: y * 10000 + m * 100 + d,
      compactDay: `${d} ${SHORT_MONTH_LABELS[m] || m}`,
    };
  }

  if (weekdayIdx > 0) {
    return {
      dayKey: `weekday-${weekdayIdx}-${lower.replace(/\s+/g, ' ')}`,
      dateSortKey: 99980000 + weekdayIdx,
      compactDay: weekdayShort,
    };
  }

  return {
    dayKey: lower.replace(/\s+/g, ' '),
    dateSortKey: 99990000,
    compactDay: dayLabel.slice(0, 12),
  };
}

/**
 * Parses a human-friendly match schedule string (e.g. "Jumat, 27 Nov 2026 • 13.00 - 14.00 WIB",
 * "Sabtu, 08:30 WIB", "Minggu, 29 Nov 2026 | 15.00 - 17.00") into clean Day & Time components.
 */
export function parseScheduleDayAndTime(
  scheduledAt?: string | null
): ParsedScheduleInfo {
  const raw = (scheduledAt || '').trim();
  if (!raw) {
    return {
      raw: '',
      dayLabel: 'Jadwal Menyusul',
      dayKey: '__unscheduled__',
      dateSortKey: 99999999,
      startMinutes: 9999,
      timeLabel: '-',
      compactLabel: '',
      isUnscheduled: true,
    };
  }

  let rawDay = '';
  let rawTime = '';

  // 1. Explicit separator: "•", "|", "/", or " — "
  const sepMatch = raw.match(/^(.+?)\s*(?:[•|/]|\s—\s)\s*(.+)$/);
  if (sepMatch) {
    rawDay = sepMatch[1]!.trim();
    rawTime = sepMatch[2]!.trim();
  } else {
    // 2. Trailing clock / range pattern: e.g. "Jumat, 27 Nov 2026 13.00 - 14.00 WIB" or "Sabtu, 08:30 WIB"
    const tailTimeMatch = raw.match(
      /^(.*?)(?:,\s*|\s+)(\d{1,2}[:.]\d{2}(?:(?:\s*[-–—.]\s*|\s+)\d{1,2}[:.]?\d{2})?(?:\s*(?:WIB|WITA|WIT))?)$/i
    );
    if (tailTimeMatch && tailTimeMatch[1]!.trim().length > 0) {
      rawDay = tailTimeMatch[1]!.replace(/[-–—,\s]+$/, '').trim();
      rawTime = tailTimeMatch[2]!.trim();
    } else if (/^\d{1,2}[:.]\d{2}/.test(raw)) {
      // Pure time only (no day written)
      rawDay = '';
      rawTime = raw;
    } else {
      // Pure day/date only (no clock written)
      rawDay = raw;
      rawTime = '';
    }
  }

  const { timeLabel, startMinutes, startShort } = normalizeTimeExpression(rawTime);

  if (!rawDay) {
    return {
      raw,
      dayLabel: 'Jadwal Pertandingan',
      dayKey: '__time_only__',
      dateSortKey: 99995000,
      startMinutes,
      timeLabel,
      compactLabel: startShort || timeLabel,
      isUnscheduled: false,
    };
  }

  const { dayKey, dateSortKey, compactDay } = extractDateSortAndKey(rawDay);
  const compactLabel =
    compactDay && startShort
      ? `${compactDay} • ${startShort}`
      : compactDay || startShort || raw;

  return {
    raw,
    dayLabel: rawDay,
    dayKey,
    dateSortKey,
    startMinutes,
    timeLabel,
    compactLabel,
    isUnscheduled: false,
  };
}

export interface ScheduleDayGroup<T> {
  dayIndex: number;
  dayKey: string;
  dayLabel: string;
  dateSortKey: number;
  isUnscheduled: boolean;
  items: Array<{ match: T; parsed: ParsedScheduleInfo }>;
}

/**
 * Groups matches by calendar day and sorts both days and intra-day matches chronologically.
 */
export function groupMatchesByScheduleDay<
  T extends {
    id: number;
    round: number;
    matchIndex: number;
    bracketType: string;
    tournamentId: number;
    scheduledAt?: string | null;
  },
>(matches: T[]): {
  dayGroups: ScheduleDayGroup<T>[];
  orderedMatches: T[];
} {
  const byKey = new Map<
    string,
    {
      dayKey: string;
      dayLabel: string;
      dateSortKey: number;
      isUnscheduled: boolean;
      firstOrder: number;
      items: Array<{ match: T; parsed: ParsedScheduleInfo }>;
    }
  >();

  matches.forEach((match, idx) => {
    const parsed = parseScheduleDayAndTime(match.scheduledAt);
    const existing = byKey.get(parsed.dayKey);
    if (existing) {
      // Prefer longer / richer dayLabel (e.g. "Jumat, 27 Nov 2026" over "27 Nov 2026")
      if (parsed.dayLabel.length > existing.dayLabel.length && !parsed.isUnscheduled) {
        existing.dayLabel = parsed.dayLabel;
      }
      existing.items.push({ match, parsed });
    } else {
      byKey.set(parsed.dayKey, {
        dayKey: parsed.dayKey,
        dayLabel: parsed.dayLabel,
        dateSortKey: parsed.dateSortKey,
        isUnscheduled: parsed.isUnscheduled,
        firstOrder: idx,
        items: [{ match, parsed }],
      });
    }
  });

  const sortedRawGroups = Array.from(byKey.values()).sort((a, b) => {
    if (a.isUnscheduled !== b.isUnscheduled) return a.isUnscheduled ? 1 : -1;
    if (a.dateSortKey !== b.dateSortKey) return a.dateSortKey - b.dateSortKey;
    return a.firstOrder - b.firstOrder;
  });

  const orderedMatches: T[] = [];
  let numberedDayCounter = 0;

  const dayGroups: ScheduleDayGroup<T>[] = sortedRawGroups.map((grp) => {
    grp.items.sort((a, b) => {
      if (a.parsed.startMinutes !== b.parsed.startMinutes) {
        return a.parsed.startMinutes - b.parsed.startMinutes;
      }
      const typeRank = (bt: string) => (bt === 'pool' ? 0 : 1);
      if (typeRank(a.match.bracketType) !== typeRank(b.match.bracketType)) {
        return typeRank(a.match.bracketType) - typeRank(b.match.bracketType);
      }
      if (a.match.round !== b.match.round) return a.match.round - b.match.round;
      if (a.match.bracketType !== b.match.bracketType) {
        return a.match.bracketType === 'third_place' ? -1 : 1;
      }
      if (a.match.tournamentId !== b.match.tournamentId) {
        return a.match.tournamentId - b.match.tournamentId;
      }
      return a.match.matchIndex - b.match.matchIndex;
    });

    for (const it of grp.items) {
      orderedMatches.push(it.match);
    }

    const dayIndex = grp.isUnscheduled ? 0 : ++numberedDayCounter;
    return {
      dayIndex,
      dayKey: grp.dayKey,
      dayLabel: grp.dayLabel,
      dateSortKey: grp.dateSortKey,
      isUnscheduled: grp.isUnscheduled,
      items: grp.items,
    };
  });

  return { dayGroups, orderedMatches };
}

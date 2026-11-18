import { describe, expect, test } from 'bun:test';
import { groupMatchesByScheduleDay, parseScheduleDayAndTime } from './schedule';

describe('Schedule Day & Time Parser and Per-Day Grouping', () => {
  test('parses bullet-separated Indonesian day/date and WIB range cleanly', () => {
    const p = parseScheduleDayAndTime('Jumat, 27 Nov 2026 • 13.00 - 14.00 WIB');
    expect(p.dayLabel).toBe('Jumat, 27 Nov 2026');
    expect(p.dayKey).toBe('2026-11-27');
    expect(p.dateSortKey).toBe(20261127);
    expect(p.startMinutes).toBe(13 * 60);
    expect(p.timeLabel).toBe('13.00 - 14.00 WIB');
    expect(p.compactLabel).toBe('Jum, 27 Nov • 13.00');
  });

  test('normalizes missing WIB and dot-range typos like 16.00.1700', () => {
    const p = parseScheduleDayAndTime('Sabtu, 28 Nov 2026 • 16.00.1700');
    expect(p.dayKey).toBe('2026-11-28');
    expect(p.timeLabel).toBe('16.00 - 17.00 WIB');
    expect(p.startMinutes).toBe(16 * 60);
  });

  test('parses space/comma separated strings without bullet like "Sabtu, 08:30 WIB"', () => {
    const p = parseScheduleDayAndTime('Sabtu, 08:30 WIB');
    expect(p.dayLabel).toBe('Sabtu');
    expect(p.timeLabel).toBe('08:30 WIB');
    expect(p.startMinutes).toBe(8 * 60 + 30);
  });

  test('groups matches per day in chronological order with unscheduled last', () => {
    const sample = [
      {
        id: 3,
        round: 4,
        matchIndex: 0,
        bracketType: 'main',
        tournamentId: 1,
        scheduledAt: 'Minggu, 29 Nov 2026 • 15.00 - 17.00 WIB',
      },
      {
        id: 1,
        round: 1,
        matchIndex: 4,
        bracketType: 'main',
        tournamentId: 1,
        scheduledAt: 'Sabtu, 28 Nov 2026 • 08.00 - 09.00 WIB',
      },
      {
        id: 2,
        round: 1,
        matchIndex: 0,
        bracketType: 'main',
        tournamentId: 1,
        scheduledAt: 'Jumat, 27 Nov 2026 • 13.00 - 14.00 WIB',
      },
      {
        id: 4,
        round: 4,
        matchIndex: 1,
        bracketType: 'third_place',
        tournamentId: 1,
        scheduledAt: 'Minggu, 29 Nov 2026 • 13.00 - 14.30 WIB',
      },
      {
        id: 5,
        round: 2,
        matchIndex: 0,
        bracketType: 'main',
        tournamentId: 1,
        scheduledAt: null,
      },
    ];

    const { dayGroups, orderedMatches } = groupMatchesByScheduleDay(sample);
    expect(dayGroups.length).toBe(4);
    expect(dayGroups[0]!.dayLabel).toBe('Jumat, 27 Nov 2026');
    expect(dayGroups[0]!.dayIndex).toBe(1);
    expect(dayGroups[1]!.dayLabel).toBe('Sabtu, 28 Nov 2026');
    expect(dayGroups[1]!.dayIndex).toBe(2);
    expect(dayGroups[2]!.dayLabel).toBe('Minggu, 29 Nov 2026');
    expect(dayGroups[2]!.dayIndex).toBe(3);
    // On Sunday, 13.00 (id=4) sorts before 15.00 (id=3)
    expect(dayGroups[2]!.items.map((x) => x.match.id)).toEqual([4, 3]);
    // Unscheduled last
    expect(dayGroups[3]!.isUnscheduled).toBe(true);
    expect(orderedMatches.map((m) => m.id)).toEqual([2, 1, 4, 3, 5]);
  });
});

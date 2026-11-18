import { describe, expect, test } from 'bun:test';
import { parseReportMedia, serializeReportMedia } from './gallery-media';
import { getNextThemeOverride, resolveThemeDark } from './theme-cycle';

describe('Seamless 3-State Theme Cycle (System -> Opposite -> Same -> System)', () => {
  test('when OS is Dark: System (null) -> Light -> Dark -> System (null)', () => {
    const systemDark = true;
    // Start at System (renders dark)
    expect(resolveThemeDark(null, systemDark)).toBe(true);

    // Click 1: switches to Light (opposite of system)
    const step1 = getNextThemeOverride(null, systemDark);
    expect(step1).toBe('light');
    expect(resolveThemeDark(step1, systemDark)).toBe(false);

    // Click 2: switches to explicit Dark
    const step2 = getNextThemeOverride(step1, systemDark);
    expect(step2).toBe('dark');
    expect(resolveThemeDark(step2, systemDark)).toBe(true);

    // Click 3: returns to Default System (null)
    const step3 = getNextThemeOverride(step2, systemDark);
    expect(step3).toBeNull();
  });

  test('when OS is Light: System (null) -> Dark -> Light -> System (null)', () => {
    const systemDark = false;
    // Start at System (renders light)
    expect(resolveThemeDark(null, systemDark)).toBe(false);

    // Click 1: switches to Dark (opposite of system)
    const step1 = getNextThemeOverride(null, systemDark);
    expect(step1).toBe('dark');
    expect(resolveThemeDark(step1, systemDark)).toBe(true);

    // Click 2: switches to explicit Light
    const step2 = getNextThemeOverride(step1, systemDark);
    expect(step2).toBe('light');
    expect(resolveThemeDark(step2, systemDark)).toBe(false);

    // Click 3: returns to Default System (null)
    const step3 = getNextThemeOverride(step2, systemDark);
    expect(step3).toBeNull();
  });
});

describe('Gallery Multi-Slide & Video Media Parser', () => {
  test('falls back cleanly to cover imagePath for legacy single-photo reports', () => {
    const legacy = parseReportMedia('/uploads/reports/cover.png', '[]');
    expect(legacy).toEqual([
      {
        type: 'image',
        url: '/uploads/reports/cover.png',
        label: 'Poster Pertandingan',
      },
    ]);
  });

  test('parses multi-slide & video items while stripping dangerous XSS URLs', () => {
    const serialized = serializeReportMedia([
      {
        type: 'video',
        url: '/uploads/reports/broadcast.mp4',
        posterUrl: '/uploads/reports/poster.png',
        label: '<script>alert(1)</script>Video Highlight',
      },
      {
        type: 'image',
        url: 'javascript:alert(1)',
        label: 'Malicious',
      },
      {
        type: 'image',
        url: '/uploads/reports/slide-1.jpg',
        label: 'Foto Momen 1',
      },
    ]);

    const items = parseReportMedia('/uploads/reports/poster.png', serialized);
    expect(items.length).toBe(2);
    expect(items[0]).toEqual({
      type: 'video',
      url: '/uploads/reports/broadcast.mp4',
      posterUrl: '/uploads/reports/poster.png',
      label: 'Video Highlight',
    });
    expect(items[1]).toEqual({
      type: 'image',
      url: '/uploads/reports/slide-1.jpg',
      label: 'Foto Momen 1',
    });
  });
});

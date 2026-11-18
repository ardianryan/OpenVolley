export type StoredTheme = 'light' | 'dark' | null;

/**
 * Computes the 3-step seamless single-button theme cycle:
 * 1. Default Sistem (null)
 * 2. Opposite of current OS theme (e.g. OS=dark -> 'light', OS=light -> 'dark')
 * 3. Same explicit mode as OS theme (e.g. OS=dark -> 'dark', OS=light -> 'light')
 * 4. Back to Default Sistem (null)
 */
export function getNextThemeOverride(
  current: StoredTheme,
  systemDark: boolean
): StoredTheme {
  const oppositeOfSystem: 'light' | 'dark' = systemDark ? 'light' : 'dark';
  const sameAsSystem: 'light' | 'dark' = systemDark ? 'dark' : 'light';

  if (current === null) {
    return oppositeOfSystem;
  }
  if (current === oppositeOfSystem) {
    return sameAsSystem;
  }
  return null;
}

export function resolveThemeDark(override: StoredTheme, systemDark: boolean): boolean {
  if (override === 'dark') return true;
  if (override === 'light') return false;
  return systemDark;
}

export function formatThemeModeLabel(override: StoredTheme, systemDark: boolean): string {
  if (override === null) {
    return `Sistem (${systemDark ? 'Gelap' : 'Terang'})`;
  }
  return override === 'dark' ? 'Gelap' : 'Terang';
}

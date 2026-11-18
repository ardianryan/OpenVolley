/**
 * Shared Anti-XSS & Input Sanitization Utilities (Zero external dependencies).
 * Protects stored database fields, CSS color tokens, and media/link URLs against
 * stored XSS, HTML tag injection, CSS injection, and dangerous URI schemes.
 */

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_BLOCK_RE = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Strips script blocks, HTML tags, and control bytes from plain-text user input.
 */
export function sanitizePlainText(input: unknown, maxLength = 200): string {
  if (input === null || input === undefined) return '';
  const raw = String(input)
    .replace(CONTROL_CHARS_RE, '')
    .replace(SCRIPT_BLOCK_RE, '')
    .replace(HTML_TAG_RE, '')
    .replace(/[<>]/g, '')
    .trim();

  return raw.length > maxLength ? raw.slice(0, maxLength).trim() : raw;
}

/**
 * Enforces strict hex color syntax (`#RGB`, `#RRGGBB`, or `#RRGGBBAA`) to prevent style injection.
 */
export function sanitizeHexColor(input: unknown, fallback = '#E09D17'): string {
  if (typeof input !== 'string') return fallback;
  const trimmed = input.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed : fallback;
}

/**
 * Validates that a URL uses only safe relative paths (`/brand/...`, `/uploads/...`) or `http(s):`
 * (blocks `javascript:`, `vbscript:`, `data:text/html`, and protocol-relative `//evil.com`).
 */
export function sanitizeAssetUrl(
  input: unknown,
  fallback = '',
  allowBlob = false
): string {
  if (typeof input !== 'string') return fallback;
  const cleaned = input.replace(CONTROL_CHARS_RE, '').trim();
  if (!cleaned) return fallback;

  if (cleaned.startsWith('/')) {
    if (cleaned.startsWith('//') || cleaned.includes('..')) {
      return fallback;
    }
    return cleaned;
  }

  if (allowBlob && cleaned.startsWith('blob:')) {
    return cleaned;
  }

  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // Reject malformed URLs
  }

  return fallback;
}

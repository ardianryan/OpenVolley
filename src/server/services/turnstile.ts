export interface TurnstileConfig {
  enabled: boolean;
  siteKey: string;
}

interface SiteverifyResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

/**
 * Returns active Turnstile configuration from environment variables.
 * Disabled gracefully when either TURNSTILE_SITE_KEY or TURNSTILE_SECRET_KEY is unset.
 */
export function getTurnstileConfig(): TurnstileConfig {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() || '';
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() || '';
  return {
    enabled: Boolean(siteKey && secretKey),
    siteKey: siteKey && secretKey ? siteKey : '',
  };
}

function getAllowedHostnames(): Set<string> {
  return new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Verifies a Cloudflare Turnstile client token via server-side siteverify.
 * Fails closed on network, timeout, malformed response, or action/hostname mismatch.
 */
export async function verifyTurnstileToken(
  token: unknown,
  remoteIp: string,
  expectedAction?: string
): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() || '';
  if (!secretKey) return true;

  if (typeof token !== 'string' || token.trim().length === 0 || token.length > 2048) {
    return false;
  }

  let result: SiteverifyResponse;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret: secretKey,
        response: token.trim(),
        remoteip: remoteIp,
      }),
    });
    if (!res.ok) return false;
    result = (await res.json()) as SiteverifyResponse;
  } catch {
    return false;
  }

  if (!result.success) return false;
  if (expectedAction && result.action && result.action !== expectedAction) {
    return false;
  }

  const allowedHostnames = getAllowedHostnames();
  if (allowedHostnames.size > 0) {
    const returnedHost = (result.hostname || '').toLowerCase();
    if (!allowedHostnames.has(returnedHost)) {
      return false;
    }
  }

  return true;
}

import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { webhooks } from '../db/schema';

export type WebhookEventType = 'match_started' | 'set_confirmed' | 'match_finished';

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isBlockedIp(ip: string): boolean {
  const clean = ip.toLowerCase().trim();
  if (clean.includes(':')) {
    if (
      clean === '::1' ||
      clean === '::' ||
      clean.startsWith('fc') ||
      clean.startsWith('fd') ||
      clean.startsWith('fe80')
    ) {
      return true;
    }
    if (clean.startsWith('::ffff:')) {
      return isBlockedIpv4(clean.slice(7));
    }
    return false;
  }
  return isBlockedIpv4(clean);
}

/**
 * Validates that a webhook destination is a public HTTP/HTTPS URL (anti-SSRF).
 */
export async function isSafeWebhookUrl(rawUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
      return false;
    }
    if (isIP(host)) return !isBlockedIp(host);
    if (process.env.NODE_ENV === 'test') return true;
    const resolved = await lookup(host, { all: true });
    if (resolved.length === 0) return false;
    return resolved.every((entry) => !isBlockedIp(entry.address));
  } catch {
    return false;
  }
}

export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function formatPlatformBody(
  platform: 'generic' | 'discord' | 'telegram',
  event: WebhookEventType | 'test_ping',
  payload: Record<string, unknown>
): string {
  if (platform === 'discord') {
    const summary =
      typeof payload.summary === 'string'
        ? payload.summary
        : `OpenVolley event: ${event}`;
    return JSON.stringify({
      username: 'OpenVolley Live',
      content: `**${event.toUpperCase()}** — ${summary}`,
      embeds: [
        {
          title: `OpenVolley • ${event}`,
          description: summary,
          color: 14720279,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  if (platform === 'telegram') {
    const summary =
      typeof payload.summary === 'string'
        ? payload.summary
        : `OpenVolley event: ${event}`;
    return JSON.stringify({
      text: `[OpenVolley] ${event.toUpperCase()}\n${summary}`,
    });
  }

  return JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });
}

async function postWebhookWithRetry(
  url: string,
  body: string,
  secret: string,
  event: string
): Promise<{ status: number | null; error: string | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'OpenVolley-Webhook/0.3',
    'X-OpenVolley-Event': event,
  };
  if (secret) {
    headers['X-OpenVolley-Signature'] = signWebhookPayload(secret, body);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        return { status: res.status, error: null };
      }
      if (res.status < 500 || attempt === 1) {
        return { status: res.status, error: `HTTP ${res.status}` };
      }
    } catch (err) {
      if (attempt === 1) {
        return { status: null, error: (err as Error).message || 'Network error' };
      }
    }
  }
  return { status: null, error: 'Delivery failed' };
}

export async function dispatchWebhookEvent(
  event: WebhookEventType,
  payload: Record<string, unknown>
): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const activeHooks = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.isEnabled, true));

    await Promise.allSettled(
      activeHooks.map(async (hook) => {
        let events: string[] = [];
        try {
          events = JSON.parse(hook.eventsJson || '[]') as string[];
        } catch {
          events = [];
        }
        if (!events.includes(event)) return;
        if (!(await isSafeWebhookUrl(hook.url))) return;

        const body = formatPlatformBody(hook.platform, event, payload);
        const result = await postWebhookWithRetry(hook.url, body, hook.secret, event);
        await db
          .update(webhooks)
          .set({
            lastStatus: result.status,
            lastError: result.error,
            lastTriggeredAt: Date.now(),
          })
          .where(eq(webhooks.id, hook.id));
      })
    );
  } catch {
    // Non-blocking background webhook dispatch
  }
}

export async function sendTestWebhook(hookId: number) {
  const hook = await db.query.webhooks.findFirst({ where: eq(webhooks.id, hookId) });
  if (!hook) throw new Error('Webhook tidak ditemukan');
  if (!(await isSafeWebhookUrl(hook.url))) {
    throw new Error('URL webhook tidak diizinkan oleh kebijakan keamanan');
  }
  const body = formatPlatformBody(hook.platform, 'test_ping', {
    summary: `Test koneksi webhook "${hook.name}" berhasil dari OpenVolley.`,
  });
  const result = await postWebhookWithRetry(hook.url, body, hook.secret, 'test_ping');
  await db
    .update(webhooks)
    .set({
      lastStatus: result.status,
      lastError: result.error,
      lastTriggeredAt: Date.now(),
    })
    .where(eq(webhooks.id, hook.id));
  return result;
}

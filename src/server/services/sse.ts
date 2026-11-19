import type { Context } from 'hono';
import type { SSEStreamingApi } from 'hono/streaming';

export type SseEventType =
  | 'match_updated'
  | 'bracket_updated'
  | 'draw_slot_updated'
  | 'master_teams_updated'
  | 'courts_updated'
  | 'tv_screen_updated'
  | 'obs_overlay_updated'
  | 'report_added'
  | 'report_deleted'
  | 'tournament_updated'
  | 'settings_updated';

export const MAX_SSE_CLIENTS = Number(process.env.MAX_SSE_CLIENTS) || 250;

const clients = new Set<SSEStreamingApi>();
let overviewVersion = 1;
const cacheListeners = new Set<() => void>();

export function onCacheInvalidate(cb: () => void) {
  cacheListeners.add(cb);
}

export function getOverviewVersion() {
  return overviewVersion;
}

export function canAcceptSseClient(): boolean {
  return clients.size < MAX_SSE_CLIENTS;
}

export function getSseClientCount(): number {
  return clients.size;
}

export function addSseClient(stream: SSEStreamingApi) {
  clients.add(stream);
}

export function removeSseClient(stream: SSEStreamingApi) {
  clients.delete(stream);
}

export function getClientIp(c: Context): string {
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  const trueClient = c.req.header('true-client-ip');
  if (trueClient) return trueClient.trim();

  const realIp = c.req.header('x-real-ip');
  if (realIp) return realIp.trim();

  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  return 'unknown';
}

const WRITE_TIMEOUT_MS = 2500;

async function writeToClientWithTimeout(
  client: SSEStreamingApi,
  message: { id: string; event: string; data: string }
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const ok = await Promise.race<boolean>([
      client.writeSSE(message).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), WRITE_TIMEOUT_MS);
      }),
    ]);
    return ok;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function broadcastEvent(event: SseEventType, data: unknown) {
  overviewVersion += 1;
  const eventId = String(overviewVersion);
  for (const cb of cacheListeners) cb();

  const payload = JSON.stringify(data);
  const message = { id: eventId, event, data: payload };

  // Fan out concurrently without letting any half-open/stalled mobile socket block
  // the scoring API response or delay delivery to healthy VIP Arena TV streams.
  const snapshot = Array.from(clients);
  void Promise.allSettled(
    snapshot.map(async (client) => {
      const ok = await writeToClientWithTimeout(client, message);
      if (!ok) {
        clients.delete(client);
        client.close().catch(() => {});
      }
    })
  );
}

import type { Context } from 'hono';
import type { SSEStreamingApi } from 'hono/streaming';

export type SseEventType =
  | 'match_updated'
  | 'bracket_updated'
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

export async function broadcastEvent(event: SseEventType, data: unknown) {
  overviewVersion += 1;
  for (const cb of cacheListeners) cb();

  const payload = JSON.stringify(data);
  const deadClients: SSEStreamingApi[] = [];

  for (const client of clients) {
    try {
      await client.writeSSE({
        event,
        data: payload,
      });
    } catch {
      deadClients.push(client);
    }
  }

  for (const dead of deadClients) {
    clients.delete(dead);
  }
}

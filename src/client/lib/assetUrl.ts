/**
 * Converts external asset URLs (e.g. S3 / IDCloudHost Object Storage buckets that lack CORS headers)
 * into same-origin `/api/public/asset-proxy?url=...` URLs so HTMLCanvasElement (`captureStream`,
 * `toBlob`, `toDataURL`), WebAudio (`decodeAudioData`), and PDF rasterizers NEVER become tainted.
 */
export function toCorsSafeAssetUrl(rawUrl?: string | null): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (
    !trimmed ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(trimmed, window.location.origin);
      if (parsed.origin === window.location.origin) {
        return trimmed;
      }
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return `/api/public/asset-proxy?url=${encodeURIComponent(parsed.toString())}`;
      }
    } catch {
      return '';
    }
  }

  return trimmed;
}

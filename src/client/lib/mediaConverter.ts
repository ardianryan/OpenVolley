import {
  computeScaledDimensions,
  isHeicHeaderOrFile,
} from '../../shared/media-detect';

export const IMAGE_INPUT_ACCEPT =
  'image/*,.heic,.heif,image/heic,image/heif';
export const VIDEO_INPUT_ACCEPT =
  'video/*,.mov,.qt,.mp4,.m4v,video/quicktime,video/mp4';

interface DecodedSource {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  close: () => void;
}

async function decodeImageSourceNative(blob: Blob): Promise<DecodedSource> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
    });
    if (bmp.width > 0 && bmp.height > 0) {
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        close: () => bmp.close(),
      };
    }
    bmp.close();
  }

  return new Promise<DecodedSource>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          close: () => {},
        });
      } else {
        reject(new Error('Dimensi gambar kosong'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Browser belum mendukung dekode format gambar ini secara langsung'));
    };
    img.src = url;
  });
}

async function renderDecodedToNormalizedFile(
  decoded: DecodedSource,
  originalName: string,
  maxDimension: number,
  preserveAlpha: boolean
): Promise<File> {
  const { width, height } = computeScaledDimensions(
    decoded.width,
    decoded.height,
    maxDimension
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    decoded.close();
    throw new Error('Gagal menyiapkan kanvas konversi gambar di browser');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded.source, 0, 0, width, height);
  decoded.close();

  const outMime = preserveAlpha ? 'image/png' : 'image/jpeg';
  const outExt = preserveAlpha ? '.png' : '.jpg';
  const outBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outMime, preserveAlpha ? undefined : 0.92)
  );

  if (!outBlob) {
    throw new Error('Gagal mengekspor gambar hasil konversi di browser');
  }

  const baseName = originalName.replace(/\.[^.]+$/, '') || `iphone-photo-${Date.now()}`;
  return new File([outBlob], `${baseName}${outExt}`, { type: outMime });
}

/**
 * Browser-first image normalizer & iPhone HEIC/HEIF auto-converter:
 * 1. Tries native GPU/OS browser decoder first (`createImageBitmap` with EXIF orientation).
 * 2. Falls back on-demand to lazy-loaded `heic2any` in the browser when opened on non-HEIC browsers (e.g. Windows/Android Chrome).
 * 3. Caps 24-48MP iPhone Pro photos to `maxDimension` (default 2160px) to prevent mobile RAM spikes.
 */
export async function normalizeImageInBrowser(
  file: File,
  options?: {
    maxDimension?: number;
    preserveAlpha?: boolean;
    onStatus?: (message: string) => void;
  }
): Promise<File> {
  const maxDimension = options?.maxDimension ?? 2160;
  const preserveAlpha =
    options?.preserveAlpha ??
    (file.type === 'image/png' ||
      file.type === 'image/webp' ||
      /\.(png|webp)$/i.test(file.name));

  const headerBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isHeic = isHeicHeaderOrFile(headerBytes, file.name, file.type);

  // Tier 1: Native Browser Hardware Decode (instant 0 KB on Safari iOS/macOS & supported platforms)
  try {
    const decoded = await decodeImageSourceNative(file);
    const scaled = computeScaledDimensions(decoded.width, decoded.height, maxDimension);
    const isStandardServerFormat =
      !isHeic &&
      (file.type === 'image/png' ||
        file.type === 'image/jpeg' ||
        file.type === 'image/webp');

    if (isStandardServerFormat && !scaled.resized) {
      decoded.close();
      return file;
    }

    if (isHeic) {
      options?.onStatus?.('Mengoptimalkan foto HEIC iPhone dengan engine browser...');
    }
    return await renderDecodedToNormalizedFile(
      decoded,
      file.name,
      maxDimension,
      preserveAlpha
    );
  } catch {
    // Proceed to Tier 2 on-demand browser HEIC decoder
  }

  // Tier 2: Lazy On-Demand Client-Side HEIC Decoder (`heic2any`) with safety timeout
  options?.onStatus?.('Mengonversi foto HEIC iPhone di browser...');
  const { default: heic2any } = await import('heic2any');
  const targetMime = preserveAlpha ? 'image/png' : 'image/jpeg';
  const converted = await Promise.race([
    heic2any({
      blob: file,
      toType: targetMime,
      quality: 0.92,
    }),
    new Promise<never>((_, reject) =>
      window.setTimeout(
        () => reject(new Error('Waktu konversi foto HEIC habis. Silakan coba ulang atau gunakan format JPG/PNG.')),
        35000
      )
    ),
  ]);
  const firstBlob = Array.isArray(converted) ? converted[0] : converted;
  if (!firstBlob) {
    throw new Error('Gagal mengonversi file HEIC di browser');
  }

  const decoded = await decodeImageSourceNative(firstBlob);
  return renderDecodedToNormalizedFile(decoded, file.name, maxDimension, preserveAlpha);
}

/**
 * Probes whether the browser's native `<video>` engine can decode BOTH container AND video frames
 * (catches HEVC `.MOV` files that play audio with `videoWidth === 0` on PCs missing HEVC codecs).
 */
export function probeNativeVideoPlayable(
  objectUrl: string,
  timeoutMs = 4500
): Promise<{ playable: boolean; duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';

    let settled = false;
    const finish = (res: {
      playable: boolean;
      duration: number;
      width: number;
      height: number;
    }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      resolve(res);
    };

    const timer = window.setTimeout(() => {
      finish({ playable: false, duration: 0, width: 0, height: 0 });
    }, timeoutMs);

    v.onerror = () => {
      finish({ playable: false, duration: 0, width: 0, height: 0 });
    };

    v.onloadeddata = () => {
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const w = v.videoWidth;
      const h = v.videoHeight;
      finish({ playable: w > 0 && h > 0 && dur > 0, duration: dur, width: w, height: h });
    };

    v.onloadedmetadata = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0 && v.duration > 0) {
        // Seek slightly so frame decoder confirms hardware/software H.264/HEVC support
        try {
          v.currentTime = Math.min(0.08, v.duration * 0.1);
        } catch {
          finish({
            playable: true,
            duration: v.duration,
            width: v.videoWidth,
            height: v.videoHeight,
          });
        }
      }
    };

    v.onseeked = () => {
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      finish({
        playable: v.videoWidth > 0 && v.videoHeight > 0 && dur > 0,
        duration: dur,
        width: v.videoWidth,
        height: v.videoHeight,
      });
    };

    v.src = objectUrl;
  });
}

let cachedFfmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null;

async function getBrowserFfmpeg(onStatus?: (msg: string) => void) {
  if (!cachedFfmpegPromise) {
    cachedFfmpegPromise = (async () => {
      onStatus?.('Menyiapkan engine konverter .MOV di browser (sekali muat)...');
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ]);
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ffmpeg;
    })().catch((err) => {
      cachedFfmpegPromise = null;
      throw err;
    });
  }
  return cachedFfmpegPromise;
}

/**
 * Prepares an uploaded `.MOV` / `.MP4` video clip in the browser:
 * 1. Tier 1: Uses zero-RAM `blob:` streaming on the browser's native GPU `<video>` engine (instant on iPhone, Mac, Android, & modern Windows).
 * 2. Tier 2: Only if native `<video>` cannot decode the codec (e.g. iPhone HEVC `.MOV` on an older Windows browser), lazy-transcodes in browser to H.264 `.mp4`.
 */
export async function prepareVideoInBrowser(
  file: File,
  options?: {
    maxFallbackSeconds?: number;
    onStatus?: (message: string) => void;
  }
): Promise<{
  url: string;
  fileName: string;
  duration: number;
  convertedInBrowser: boolean;
}> {
  const nativeUrl = URL.createObjectURL(file);
  const probe = await probeNativeVideoPlayable(nativeUrl);

  if (probe.playable) {
    return {
      url: nativeUrl,
      fileName: file.name,
      duration: probe.duration,
      convertedInBrowser: false,
    };
  }

  // Tier 2: Browser WASM Transcode Fallback when native video codec is unsupported
  URL.revokeObjectURL(nativeUrl);
  const maxSec = options?.maxFallbackSeconds ?? 20;
  const ffmpeg = await getBrowserFfmpeg(options?.onStatus);
  const { fetchFile } = await import('@ffmpeg/util');

  const onProgress = ({ progress }: { progress: number }) => {
    const pct = Math.min(99, Math.max(1, Math.round(progress * 100)));
    options?.onStatus?.(`Mengonversi video .MOV iPhone di browser (${pct}%)...`);
  };
  ffmpeg.on('progress', onProgress);

  const inName = `in-${Date.now()}.mov`;
  const outName = `out-${Date.now()}.mp4`;

  try {
    options?.onStatus?.('Mengonversi video .MOV iPhone ke MP4 di browser...');
    await ffmpeg.writeFile(inName, await fetchFile(file));
    await ffmpeg.exec([
      '-i',
      inName,
      '-t',
      String(maxSec),
      '-vf',
      "scale='min(1280,iw)':-2",
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '25',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outName,
    ]);

    const outData = await ffmpeg.readFile(outName);
    const bytes =
      outData instanceof Uint8Array
        ? new Uint8Array(outData)
        : new TextEncoder().encode(String(outData));
    const mp4Blob = new Blob([bytes], { type: 'video/mp4' });
    const mp4Url = URL.createObjectURL(mp4Blob);
    const verify = await probeNativeVideoPlayable(mp4Url);

    return {
      url: mp4Url,
      fileName: file.name.replace(/\.[^.]+$/, '') + '.mp4',
      duration: verify.duration || maxSec,
      convertedInBrowser: true,
    };
  } finally {
    ffmpeg.off('progress', onProgress);
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});
  }
}

/**
 * Transcodes a browser MediaRecorder Blob (WebM or fragmented MP4) into a
 * universally compatible Social-Media MP4 (H.264 High@L4.1, yuv420p, 30fps CFR,
 * AAC-LC 44.1kHz audio, +faststart moov atom at file start) for Instagram,
 * TikTok, Facebook, and WhatsApp.
 */
export async function transcodeToSocialMp4(
  rawBlob: Blob,
  onStatus?: (message: string) => void
): Promise<Blob> {
  const ffmpeg = await getBrowserFfmpeg(onStatus);
  const { fetchFile } = await import('@ffmpeg/util');

  const onProgress = ({ progress }: { progress: number }) => {
    const pct = Math.min(99, Math.max(1, Math.round(progress * 100)));
    onStatus?.(`Mengoptimalkan MP4 untuk IG/TikTok/WA (${pct}%)...`);
  };
  ffmpeg.on('progress', onProgress);

  const ext = rawBlob.type.includes('mp4') ? 'mp4' : 'webm';
  const inName = `raw-${Date.now()}.${ext}`;
  const outName = `social-${Date.now()}.mp4`;

  try {
    onStatus?.('Mengonversi video ke standar MP4 (H.264 + AAC)...');
    await ffmpeg.writeFile(inName, await fetchFile(rawBlob));
    await ffmpeg.exec([
      '-i',
      inName,
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-level',
      '4.1',
      '-preset',
      'ultrafast',
      '-crf',
      '22',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-movflags',
      '+faststart',
      outName,
    ]);

    const outData = await ffmpeg.readFile(outName);
    const bytes =
      outData instanceof Uint8Array
        ? new Uint8Array(outData)
        : new TextEncoder().encode(String(outData));
    return new Blob([bytes], { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', onProgress);
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});
  }
}

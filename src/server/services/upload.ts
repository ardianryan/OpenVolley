import { S3Client } from 'bun';
import { mkdirSync, unlinkSync } from 'node:fs';
import { extname } from 'node:path';
import { parseReportMedia } from '../../shared/gallery-media';

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const VIDEO_EXT_TO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

export function detectImageSignature(bytes: Uint8Array): '.png' | '.jpg' | '.webp' | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return '.png';
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return '.jpg';
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return '.webp';
  }

  return null;
}

export function detectVideoSignature(bytes: Uint8Array): '.mp4' | '.webm' | '.mov' | null {
  // WebM / Matroska EBML header: 1A 45 DF A3
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return '.webm';
  }

  // ISO-BMFF container: bytes[4..8] === "ftyp"
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (HEIC_BRANDS.has(brand.toLowerCase())) {
      return null;
    }
    if (brand === 'qt  ') {
      return '.mov';
    }
    return '.mp4';
  }

  return null;
}

function getS3Config() {
  if (process.env.NODE_ENV === 'test') return null;
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const client = new S3Client({
    endpoint,
    bucket,
    region: process.env.S3_REGION || 'auto',
    accessKeyId,
    secretAccessKey,
    virtualHostedStyle: process.env.S3_PATH_STYLE === 'false',
  });

  const prefix = (process.env.S3_PREFIX || '').replace(/^\/+|\/+$/g, '');
  const publicBase = (process.env.S3_PUBLIC_URL || `${endpoint}/${bucket}`).replace(/\/+$/, '');

  return { client, prefix, publicBase };
}

export async function saveUploadedImage(
  file: File,
  subfolder: 'logos' | 'reports'
): Promise<string> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Ukuran file gambar maksimal 10MB');
  }

  const extFromMime = ALLOWED_IMAGE_TYPES[file.type];
  const rawExt = extname(file.name).toLowerCase();
  const ext =
    extFromMime || (['.png', '.jpg', '.jpeg', '.webp'].includes(rawExt) ? rawExt : '');

  if (!ext) {
    throw new Error('Format file gambar harus PNG, JPG, atau WEBP');
  }

  const bytes = await file.arrayBuffer();
  const u8 = new Uint8Array(bytes);
  const detectedExt = detectImageSignature(u8);
  if (!detectedExt) {
    throw new Error('Isi file tidak valid: hanya gambar PNG, JPG, atau WEBP asli yang diizinkan');
  }

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${detectedExt}`;
  const canonicalMime = EXT_TO_MIME[detectedExt] || 'image/png';
  const s3 = getS3Config();

  if (s3) {
    const key = s3.prefix
      ? `${s3.prefix}/${subfolder}/${filename}`
      : `${subfolder}/${filename}`;

    await s3.client.write(key, u8, {
      type: canonicalMime,
      acl: 'public-read',
    });

    return `${s3.publicBase}/${key}`;
  }

  // Fallback to local disk when S3 is not configured
  const dir = `./data/uploads/${subfolder}`;
  mkdirSync(dir, { recursive: true });
  await Bun.write(`${dir}/${filename}`, u8);
  return `/uploads/${subfolder}/${filename}`;
}

export async function saveUploadedReportVideo(file: File): Promise<string> {
  if (file.size > 45 * 1024 * 1024) {
    throw new Error('Ukuran file video galeri maksimal 45MB');
  }

  const bytes = await file.arrayBuffer();
  const u8 = new Uint8Array(bytes);
  const detectedExt = detectVideoSignature(u8);
  if (!detectedExt) {
    throw new Error('Isi file video tidak valid: hanya video MP4, WEBM, atau MOV asli yang diizinkan');
  }

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${detectedExt}`;
  const canonicalMime = VIDEO_EXT_TO_MIME[detectedExt] || 'video/mp4';
  const s3 = getS3Config();

  if (s3) {
    const key = s3.prefix ? `${s3.prefix}/reports/${filename}` : `reports/${filename}`;

    await s3.client.write(key, u8, {
      type: canonicalMime,
      acl: 'public-read',
    });

    return `${s3.publicBase}/${key}`;
  }

  const dir = './data/uploads/reports';
  mkdirSync(dir, { recursive: true });
  await Bun.write(`${dir}/${filename}`, u8);
  return `/uploads/reports/${filename}`;
}

export async function deleteUploadedImage(assetUrl: string): Promise<void> {
  if (!assetUrl) return;

  const s3 = getS3Config();
  if (s3 && assetUrl.startsWith(s3.publicBase + '/')) {
    const key = assetUrl.slice(s3.publicBase.length + 1);
    try {
      await s3.client.delete(key);
    } catch {
      // Ignore S3 delete errors
    }
    return;
  }

  if (
    (assetUrl.startsWith('/uploads/reports/') || assetUrl.startsWith('/uploads/logos/')) &&
    !assetUrl.includes('..')
  ) {
    try {
      unlinkSync(`./data${assetUrl}`);
    } catch {
      // Ignore if local file already removed
    }
  }
}

export async function deleteUploadedReportAssets(
  imagePath: string,
  mediaJson?: string | null
): Promise<void> {
  const urls = new Set<string>();
  if (imagePath) urls.add(imagePath);
  for (const item of parseReportMedia(imagePath, mediaJson)) {
    if (item.url) urls.add(item.url);
    if (item.posterUrl) urls.add(item.posterUrl);
  }
  for (const url of urls) {
    await deleteUploadedImage(url);
  }
}

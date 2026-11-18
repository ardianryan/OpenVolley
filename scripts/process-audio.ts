import { S3Client } from 'bun';
import { mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FILE_MAP: Array<{ prefix: string; id: string }> = [
  { prefix: 'Above_the_Net', id: 'above-the-net' },
  { prefix: 'Gravity_Defying', id: 'gravity-defying' },
  { prefix: 'Sudden_Death', id: 'sudden-death' },
  { prefix: 'Match_Point', id: 'match-point' },
  { prefix: 'The_Final_Possession', id: 'the-final-possession' },
  { prefix: 'The_Final_Stretch', id: 'the-final-stretch' },
  { prefix: 'Before_We_Touch_the_Sky', id: 'before-we-touch-the-sky' },
  { prefix: 'Under_the_Floodlights', id: 'under-the-floodlights' },
  { prefix: 'The_Fourth_Quarter_Lead', id: 'the-fourth-quarter-lead' },
  { prefix: 'The_Eleventh_Round', id: 'the-eleventh-round' },
  { prefix: 'Before_the_Siren', id: 'before-the-siren' },
  { prefix: 'Before_the_Final_Whistle', id: 'before-the-final-whistle' },
  { prefix: 'Tunnel_Walk', id: 'tunnel-walk' },
  { prefix: 'The_Golden_Mile', id: 'the-golden-mile' },
  { prefix: 'Midfield_Rush', id: 'midfield-rush' },
  { prefix: 'The_Golden_Banner', id: 'the-golden-banner' },
  { prefix: 'The_Weight_of_Gold', id: 'the-weight-of-gold' },
  { prefix: 'Twelve_O_Clock_Approach', id: 'twelve-o-clock-approach' },
];

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  console.error('Missing S3 credentials in environment (.env).');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint,
  bucket,
  region: process.env.S3_REGION || 'auto',
  accessKeyId,
  secretAccessKey,
  virtualHostedStyle: process.env.S3_PATH_STYLE === 'false',
});

const prefix = (process.env.S3_PREFIX || '').replace(/^\/+|\/+$/g, '');
const publicBase = (process.env.S3_PUBLIC_URL || `${endpoint}/${bucket}`).replace(/\/+$/, '');

const downloadsDir = join(homedir(), 'Downloads');
const tmpDir = '/tmp/openvolley-audio-compress';
mkdirSync(tmpDir, { recursive: true });

const downloadFiles = readdirSync(downloadsDir);

let totalOrigBytes = 0;
let totalCompBytes = 0;
let processedCount = 0;
let corsHeaderSample = '';

for (const item of FILE_MAP) {
  const matchName = downloadFiles.find(
    (f) => f.startsWith(item.prefix) && f.toLowerCase().endsWith('.mp3')
  );
  if (!matchName) {
    console.warn(`[SKIP] Not found in Downloads: ${item.prefix}*.mp3`);
    continue;
  }

  const srcPath = join(downloadsDir, matchName);
  const dstPath = join(tmpDir, `${item.id}.mp3`);
  const origSize = statSync(srcPath).size;

  // Compress to 96kbps 44.1kHz Stereo MP3 with broadcast loudness normalization (-14 LUFS)
  const proc = Bun.spawnSync(
    [
      '/opt/homebrew/bin/ffmpeg',
      '-y',
      '-i',
      srcPath,
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-af',
      'loudnorm=I=-14:TP=-1.5:LRA=11',
      dstPath,
    ],
    { stdout: 'ignore', stderr: 'pipe' }
  );

  if (proc.exitCode !== 0) {
    console.error(`[FAIL] ffmpeg failed for ${matchName}:`, proc.stderr.toString());
    process.exit(1);
  }

  const compBytes = await Bun.file(dstPath).arrayBuffer();
  const compSize = compBytes.byteLength;
  const key = prefix ? `${prefix}/audio/${item.id}.mp3` : `audio/${item.id}.mp3`;

  await s3.write(key, compBytes, {
    type: 'audio/mpeg',
    acl: 'public-read',
  });

  const publicUrl = `${publicBase}/${key}`;
  const res = await fetch(publicUrl, {
    method: 'HEAD',
    headers: { Origin: 'http://localhost:3000' },
  });

  if (!res.ok) {
    console.error(`[FAIL] S3 verify HTTP ${res.status} for ${publicUrl}`);
    process.exit(1);
  }

  if (!corsHeaderSample) {
    corsHeaderSample = res.headers.get('access-control-allow-origin') || '(none)';
  }

  // Delete original file in Downloads after verified upload
  unlinkSync(srcPath);

  totalOrigBytes += origSize;
  totalCompBytes += compSize;
  processedCount += 1;

  const pct = Math.round(((origSize - compSize) / origSize) * 100);
  console.log(
    `[OK] ${item.id}.mp3 | ${(origSize / 1024).toFixed(0)} KB -> ${(compSize / 1024).toFixed(0)} KB (-${pct}%) | Verified 200`
  );
}

rmSync(tmpDir, { recursive: true, force: true });

console.log('---');
console.log(
  `Processed ${processedCount}/${FILE_MAP.length} tracks | Total: ${(totalOrigBytes / 1024 / 1024).toFixed(2)} MB -> ${(totalCompBytes / 1024 / 1024).toFixed(2)} MB`
);
console.log(`CORS Access-Control-Allow-Origin: ${corsHeaderSample}`);

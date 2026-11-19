import { S3Client } from 'bun';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { sqlite } from '../db';

export interface S3BackupEntry {
  key: string;
  size: number;
  lastModified: string;
}

function getBackupS3Config() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

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
  const backupPrefix = prefix ? `${prefix}/backups/` : 'backups/';
  return { client, backupPrefix };
}

function formatSnapshotStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/**
 * Creates a transactionally consistent SQLite hot snapshot via `VACUUM INTO`
 * and uploads it to S3 if configured.
 */
export async function createSqliteS3Backup(): Promise<{
  key: string;
  sizeBytes: number;
  uploadedToS3: boolean;
}> {
  mkdirSync('./data/backups', { recursive: true });
  const filename = `openvolley-${formatSnapshotStamp()}.db`;
  const tempPath = join('./data/backups', filename);
  const safeSqlPath = tempPath.replace(/'/g, "''");

  try {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    sqlite.exec(`VACUUM INTO '${safeSqlPath}'`);
    const bytes = readFileSync(tempPath);
    const s3 = getBackupS3Config();

    if (!s3) {
      return {
        key: tempPath,
        sizeBytes: bytes.byteLength,
        uploadedToS3: false,
      };
    }

    const key = `${s3.backupPrefix}${filename}`;
    await s3.client.write(key, bytes, {
      type: 'application/vnd.sqlite3',
    });

    // Prune older S3 backups beyond retention limit
    const retention = Math.max(1, Number(process.env.BACKUP_RETENTION_COUNT) || 10);
    try {
      const listed = await s3.client.list({ prefix: s3.backupPrefix, maxKeys: 100 });
      const sorted = (listed.contents ?? [])
        .filter((item) => item.key.endsWith('.db'))
        .sort((a, b) => b.key.localeCompare(a.key));
      for (const stale of sorted.slice(retention)) {
        await s3.client.delete(stale.key).catch(() => {});
      }
    } catch {
      // Ignore non-fatal pruning failure
    }

    return {
      key,
      sizeBytes: bytes.byteLength,
      uploadedToS3: true,
    };
  } finally {
    // Remove local temp file when uploaded to S3
    if (getBackupS3Config() && existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup failure
      }
    }
  }
}

export async function listS3Backups(): Promise<{
  s3Configured: boolean;
  backups: S3BackupEntry[];
}> {
  const s3 = getBackupS3Config();
  if (!s3) {
    return { s3Configured: false, backups: [] };
  }
  const listed = await s3.client.list({ prefix: s3.backupPrefix, maxKeys: 30 });
  const backups = (listed.contents ?? [])
    .filter((item) => item.key.endsWith('.db'))
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((item) => ({
      key: item.key,
      size: Number(item.size ?? 0),
      lastModified: String(item.lastModified ?? ''),
    }));
  return { s3Configured: true, backups };
}

let backupTimer: ReturnType<typeof setInterval> | null = null;

export function startBackupScheduler() {
  if (backupTimer || process.env.NODE_ENV === 'test') return;
  const intervalHours = Number(process.env.BACKUP_INTERVAL_HOURS) || 0;
  if (intervalHours <= 0 || !getBackupS3Config()) return;

  const ms = Math.max(1, intervalHours) * 60 * 60 * 1000;
  backupTimer = setInterval(() => {
    void createSqliteS3Backup().catch((err) => {
      console.error('Scheduled S3 SQLite backup failed:', err);
    });
  }, ms);
}

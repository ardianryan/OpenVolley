import {
  Bell,
  DatabaseBackup,
  HardDriveDownload,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { WebhookItem } from '../types';

interface BackupEntry {
  key: string;
  size: number;
  lastModified: string;
}

export function IntegrationsManager() {
  const [hooks, setHooks] = useState<WebhookItem[]>([]);
  const [s3Configured, setS3Configured] = useState(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [runningBackup, setRunningBackup] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [platform, setPlatform] = useState<'generic' | 'discord' | 'telegram'>('discord');

  const loadAll = useCallback(async () => {
    const [hRes, bRes] = await Promise.all([
      apiFetch<{ webhooks: WebhookItem[] }>('/api/admin/webhooks'),
      apiFetch<{ s3Configured: boolean; backups: BackupEntry[] }>('/api/admin/backups'),
    ]);
    setHooks(hRes.webhooks);
    setS3Configured(bRes.s3Configured);
    setBackups(bRes.backups);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const flash = (msg: string) => {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          name,
          url,
          secret,
          platform,
          events: ['match_started', 'set_confirmed', 'match_finished'],
        }),
      });
      setName('');
      setUrl('');
      setSecret('');
      await loadAll();
      flash('Webhook berhasil ditambahkan');
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const handleRunBackup = async () => {
    setRunningBackup(true);
    try {
      const res = await apiFetch<{
        snapshot: { key: string; sizeBytes: number; uploadedToS3: boolean };
      }>('/api/admin/backups/run', { method: 'POST' });
      await loadAll();
      flash(
        `Snapshot dibuat: ${res.snapshot.key} (${Math.round(res.snapshot.sizeBytes / 1024)} KB)`
      );
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setRunningBackup(false);
    }
  };

  return (
    <div className="space-y-6">
      {statusMsg && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-800 dark:text-amber-300">
          {statusMsg}
        </div>
      )}

      {/* Outbound Webhooks */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-amber-500" />
          <div>
            <h2 className="font-display text-lg font-extrabold uppercase">
              Outbound Webhooks (Discord / Telegram / JSON)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Notifikasi otomatis bertanda tangan HMAC-SHA256 saat match dimulai, set selesai, dan match berakhir.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateWebhook} className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <input
            type="text"
            required
            placeholder="Nama (misal: Bot Panitia)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            type="url"
            required
            placeholder="https://discord.com/api/webhooks/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 lg:col-span-2"
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'generic' | 'discord' | 'telegram')}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="discord">Discord</option>
            <option value="telegram">Telegram Relay</option>
            <option value="generic">Generic JSON + HMAC</option>
          </select>
          <button
            type="submit"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
          >
            <Plus className="h-3.5 w-3.5" />
            Simpan Webhook
          </button>
          <input
            type="text"
            placeholder="HMAC Secret (opsional, untuk header X-OpenVolley-Signature)"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 sm:col-span-2 lg:col-span-5"
          />
        </form>

        <div className="mt-4 space-y-2">
          {hooks.length === 0 ? (
            <p className="text-xs text-slate-500">Belum ada webhook terdaftar.</p>
          ) : (
            hooks.map((h) => (
              <div
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900 dark:text-white">
                    {h.name}{' '}
                    <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase dark:bg-slate-800">
                      {h.platform}
                    </span>
                  </p>
                  <p className="truncate font-mono text-[11px] text-slate-500">{h.url}</p>
                  {h.lastTriggeredAt && (
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      Terakhir: HTTP {h.lastStatus ?? '-'} {h.lastError ? `(${h.lastError})` : 'OK'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await apiFetch<{ ok: boolean; result: { status: number | null; error: string | null } }>(
                        `/api/admin/webhooks/${h.id}/test`,
                        { method: 'POST' }
                      );
                      await loadAll();
                      flash(res.ok ? 'Test ping berhasil terkirim' : `Gagal: ${res.result.error}`);
                    }}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold hover:border-amber-400 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <Send className="h-3 w-3" />
                    Test
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/admin/webhooks/${h.id}`, { method: 'DELETE' });
                      await loadAll();
                    }}
                    className="inline-flex min-h-9 items-center rounded-lg border border-red-200 px-2.5 py-1 text-red-600 hover:bg-red-500/10 dark:border-red-900/50 dark:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* SQLite S3 Snapshot Backup */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5 text-amber-500" />
            <div>
              <h2 className="font-display text-lg font-extrabold uppercase">
                Snapshot Backup SQLite (VACUUM INTO → S3)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {s3Configured
                  ? 'S3 terhubung. Snapshot konsisten tanpa menghentikan skor live.'
                  : 'S3 belum dikonfigurasi; snapshot akan disimpan di ./data/backups/.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={runningBackup}
            onClick={handleRunBackup}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-amber-500 dark:text-slate-950"
          >
            <HardDriveDownload className="h-4 w-4" />
            {runningBackup ? 'Membuat Snapshot...' : 'Backup Sekarang'}
          </button>
        </div>

        {backups.length > 0 && (
          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {backups.slice(0, 8).map((b) => (
              <div
                key={b.key}
                className="flex items-center justify-between px-3.5 py-2 text-xs"
              >
                <span className="font-mono text-[11px] font-semibold">{b.key}</span>
                <span className="text-slate-500">
                  {Math.round(b.size / 1024)} KB
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

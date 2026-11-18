# Production Deployment Guide

OpenVolley is packaged as a stateless application container with a single persistent directory (`/app/data`) holding the SQLite WAL database (`openvolley.db`) and optional local fallback uploads.

---

## 1. Docker Compose Deployment (Recommended)

```bash
git clone https://github.com/ardianryan/OpenVolley.git
cd OpenVolley

cp .env.example .env
```

Edit `.env` with production secrets:

```ini
PORT=3000
JWT_SECRET=replace_with_64_char_hex_from_openssl_rand_hex_32
ADMIN_DEFAULT_PASSWORD=replace_before_first_boot
MAX_SSE_CLIENTS=250
```

Launch the stack:

```bash
docker compose up -d
docker compose ps
```

Verify container health:

```bash
curl -fsS http://127.0.0.1:3000/api/public/health
```

---

## 2. Pulling Prebuilt Images from GitHub Packages (GHCR)

Every push to `main` and every `v*.*.*` release tag automatically builds and attests multi-architecture (`linux/amd64`, `linux/arm64`) images to `ghcr.io/ardianryan/openvolley`:

```bash
docker pull ghcr.io/ardianryan/openvolley:0.1.0
```

---

## 3. Reverse Proxy (Nginx + Cloudflare)

When deploying behind Cloudflare ("Orange Cloud") and Nginx:

1. Copy [`deploy/nginx-openvolley.conf`](../deploy/nginx-openvolley.conf) into `/etc/nginx/sites-available/openvolley.conf`.
2. Replace `volley.example.com` with your domain.
3. Reload Nginx: `sudo nginx -t && sudo systemctl reload nginx`.

Why this configuration matters:
- **SSE Instant Delivery:** `proxy_buffering off` and `proxy_read_timeout 3600s` on `/api/public/stream` and `/api/public/tv-stream` ensure score updates push immediately without waiting for Nginx output buffers.
- **Accurate Per-Visitor Rate Limiting:** Restores genuine client IPs from `CF-Connecting-IP` so brute-force rate limiters isolate individual clients rather than throttling Cloudflare edge PoPs.
- **Automatic `Secure` Cookies:** Passing `X-Forwarded-Proto $scheme` triggers automatic `Secure` flags on `ov_token` and `ov_tv_vip` cookies.

---

## 4. Configuring S3-Compatible Object Storage

OpenVolley supports any S3-compatible provider (Cloudflare R2, AWS S3, MinIO, DigitalOcean Spaces, IDCloudHost IS3).

1. Enable **Public Read** on your media prefix (or attach a public CDN domain) and configure **CORS** (`AllowedOrigins: ["*"]` or your domain, `AllowedMethods: ["GET", "HEAD"]`) if serving studio audio tracks from the same bucket.
2. Populate `S3_ENDPOINT`, `S3_BUCKET`, `S3_PREFIX`, `S3_PUBLIC_URL`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` in `.env`.
3. If `S3_*` variables are omitted, OpenVolley seamlessly writes images and videos to `./data/uploads/` and serves them with strict anti-XSS `nosniff` + `sandbox` CSP headers.

---

## 5. Maintenance Shield & Zero-Downtime SQLite Backups

### Maintenance Mode (`HTTP 503`)
To temporarily pause spectator portal traffic while keeping `/api/public/health` and `/back-office` operational:

```bash
MAINTENANCE_MODE=true docker compose up -d
```

### Online SQLite WAL Backup
Because OpenVolley runs SQLite in WAL mode, use `sqlite3 .backup` or `VACUUM INTO` for atomic online snapshots without stopping the server:

```bash
docker exec openvolley bun -e '
  import { sqlite } from "./src/server/db";
  sqlite.exec(`VACUUM INTO "/app/data/backup-${Date.now()}.db"`);
'
```

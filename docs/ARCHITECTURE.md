# System Architecture & Internals

OpenVolley is engineered to deliver sub-second matchday updates and broadcast-grade media generation while running comfortably on a modest single-node VPS, venue mini-PC, or laptop (`>= 1 vCPU`, `512 MB RAM`).

---

## 1. High-Level Runtime Topology

- **Runtime & HTTP Server:** [Bun](https://bun.sh) + [Hono](https://hono.dev) serving REST endpoints, Server-Sent Events (SSE), and static Vite client bundles from one process.
- **Database:** Embedded `bun:sqlite` with [Drizzle ORM](https://orm.drizzle.team) configured in **WAL (`Write-Ahead Logging`)** mode with `PRAGMA foreign_keys = ON`.
- **Frontend:** React 19 + Tailwind CSS v4 + Three.js (`VolleyballArena3D` & offscreen studio 3D ball) + lazy-loaded media codecs (`heic2any`, `@ffmpeg/ffmpeg`).
- **Object Storage:** Native `Bun.S3Client` supporting Cloudflare R2, AWS S3, MinIO, and IDCloudHost IS3, with automatic transparent fallback to `./data/uploads/`.

---

## 2. Directory Structure

```text
OpenVolley/
├── src/
│   ├── client/               # React 19 SPA, Arena TV, Back-Office & Media Studio
│   │   ├── components/       # Scorecards, BracketView, GalleryMediaCard, ErrorPage, 3D Hero
│   │   ├── lib/              # API client, 3D volleyball renderer, WebAudio SFX, HEIC/MOV converter
│   │   └── pages/            # PublicPortal, ArenaTvDisplay, BackOffice, LiveOperator, MediaStudio
│   ├── server/               # Bun + Hono HTTP & SSE server
│   │   ├── db/               # Drizzle SQLite schema, safe column migrations & default seeding
│   │   ├── lib/              # Terminal startup banner & LAN IPv4 discovery
│   │   ├── middleware/       # JWT RBAC, strict CSP, sanitizers & sliding-window rate limiter
│   │   ├── routes/           # /api/public, /api/auth, /api/admin, /api/media
│   │   └── services/         # Bracket math, rally scoring engine, SSE hub & magic-byte uploads
│   └── shared/               # Isomorphic logic shared + unit-tested across server and client
├── public/                   # Static brand SVGs, PWA manifest, sw.js & external theme-init.js
├── deploy/                   # Production Nginx + Cloudflare Real-IP reverse proxy config
├── docs/                     # English technical documentation & OpenVolley project banner
├── Dockerfile                # Multi-stage Alpine container image
└── docker-compose.yml        # Production Docker stack with persistent volume & healthcheck
```

---

## 3. Adaptive Real-Time Delivery (`SSE` + `ETag`)

Stadium cellular networks and sudden school/community tournament traffic spikes can easily exhaust naive WebSocket servers. OpenVolley solves this with a two-tier synchronization strategy:

1. **Tier 1 — Instant SSE Push (`/api/public/stream`):**
   - Up to `MAX_SSE_CLIENTS` (default `150`) concurrent public spectators hold open lightweight chunked HTTP streams.
   - Every score mutation, bracket advancement, or gallery upload increments a monotonic `overviewVersion` counter and broadcasts a compact delta event (`score_update`, `report_added`, etc.).
2. **Tier 2 — Graceful `ETag` (`304`) Fallback:**
   - When public SSE capacity is full (`HTTP 503` on `/api/public/stream`), spectators automatically switch to 5-second conditional `GET /api/public/overview` requests carrying `If-None-Match: "v<N>"`.
   - Unchanged states return an empty `304 Not Modified` response in microseconds.
3. **Priority VIP Arena TV Channel (`/api/public/tv-stream`):**
   - Venue projectors and LED walls authenticate once via the constant-time TV PIN gate (`/api/public/tv-auth`) and connect to `/api/public/tv-stream`, bypassing public SSE limits so courtside displays never lag.

---

## 4. Symmetric Bracket & Rally Scoring Engine

- **Bracket Seeding & Draw (`src/server/services/bracket.ts`):**
  - Supports both seeded brackets (`buildSeedOrder` for `2–32` teams with automatic `bye` advancement) and blank Technical Meeting draw trees (`16-team` or `8-team` symmetric left/right halves).
  - Each match node stores `nextMatchId` / `nextMatchSlot` for winners and `loserNextMatchId` / `loserNextMatchSlot` for semifinal losers advancing to the Third-Place match.
- **Rally & Set-Point Guard (`src/server/services/scoring.ts`):**
  - Enforces regular set targets (default `25`), deciding final-set targets (default `15`), and optional 2-point `Deuce` rules.
  - Reaching a set-winning point enters an explicit **`awaitingConfirm`** state rather than immediately locking the set, allowing the court operator to verify with the first referee or tap **Undo** (`undoLastAction`) if a button was pressed prematurely.

---

## 5. Zero-Server-CPU Broadcast Media Studio

All graphic and video rendering happens **100% on the client device** (`MediaStudio.tsx`), keeping server CPU usage near zero even while media staff export Full-HD videos:

- **Canvas 2D + Offscreen Three.js Compositor:** Renders `1080×1920` (`9:16`), `1080×1350` (`4:5`), `1920×1080` (`16:9`), and `1080×1080` (`1:1`) frames at `30 fps` via `canvas.captureStream(30)` + `MediaRecorder`.
- **Adaptive Timeline (`src/shared/media-timeline.ts`):** Dynamically scales Scene 4 duration for `1–3` photos (`18.0s`–`21.8s` with diagonal golden wipes) or trimmed court video clips (`2.0s`–`15.0s`).
- **WebAudio Broadcast Mixer:** Mixes CORS-enabled S3 soundtrack buffers, procedural transition sound effects (`src/client/lib/audioSfx.ts`), and zero-RAM streamed court video audio with automatic BGM ducking during active rallies.
- **Browser-First iPhone Media Pipeline (`src/client/lib/mediaConverter.ts`):** Detects ISO-BMFF `ftypheic`/`ftypqt` magic bytes (`src/shared/media-detect.ts`), decodes natively via GPU hardware when supported, and lazily loads `heic2any` or `@ffmpeg/ffmpeg` WebAssembly only as a fallback.

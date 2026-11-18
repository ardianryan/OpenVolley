# Changelog

All notable changes to **OpenVolley** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- Pluggable UI localization dictionary (`id-ID` + `en-US` full toggle).
- Transparent OBS Browser Source overlay (`/obs/:matchId`) for live YouTube / Twitch match streams.
- Optional Webhook / Discord / Telegram match-result notifications.

---

## [0.2.0] - 2026-11-18

### Added
- **Dynamic Favicon, Server-Injected SEO & Auto-Generated Social Image (`1200×630` PNG)**:
  - Default favicon upgraded to `/brand/svc-crest-color.svg` and dynamically synced to `siteSettings.logoUrl` on both server HTML responses and live client updates.
  - Server-side HTML meta injector (`injectDynamicHtmlMeta`) populating `<title>`, `<meta name="description">`, OpenGraph (`og:*`), and Twitter Card (`twitter:*`) tags from `siteSettings`.
  - Auto-generated `1200×630` PNG social share card at `GET /api/public/og-image.png` powered by `@resvg/resvg-wasm` and bundled fonts (`public/fonts/`), with an optional custom Social Banner upload override in **Branding & Logo**.
- **Official Vector PDF Suite (Tournament Bulletin + Match Summary) & "Dokumen Resmi" Hub**:
  - Lazy-loaded client vector PDF engine (`src/client/lib/pdfDocuments.ts` via `jspdf` code-split chunk) adding `0 KB` to initial portal load:
    - **Official Tournament Bulletin PDF** (`downloadTournamentBulletinPdf`): Vector championship cover (or custom uploaded cover), 2-column Contingent/Pool cards with dynamic optional `Coach`, `Manager`, and `Jersey Colors` (auto-hidden when empty), FIVB Pool Standings + Schedule/Results table, and crisp full-page vector **Main Knockout Bracket** trees per category (including `3rd Place Match` box and center watermark).
    - **Official Match Summary PDF** (`downloadMatchSummaryPdf`): 1-page A4 referee sheet with official letterhead, match metadata, set-by-set points, timeouts & substitutions per set, rally point ratio, and 4-column signature blocks.
  - Dedicated **Dokumen Resmi** Back-Office module (`/back-office/dokumen`) + contextual PDF export buttons in **Kategori & Bagan**, **Live Operator**, and **Public Spectator Portal / Match Center Modal** (governed by an Admin `ON/OFF` public download toggle).
- **Championship & Stage-Aware Broadcast Templates in Media Studio**:
  - Added **`CHAMPIONS & PODIUM`** template supporting 4 ceremony variants (`1st Place Champion`, `2nd Place Runner-Up`, `3rd Place Winner`, and `Official Podium 1-2-3`) paired with ceremony soundtracks and vector crown/medal graphics.
  - Added automatic & manual **Stage Visual Themes** (`Pool Stage`, `Round of 16`, `Quarter-Final`, `Semi-Final`, `3rd Place Match`, `Grand Final`) across `Live`, `Final Score`, `Upcoming`, and `Highlight` templates.
- **Per-Set Timeouts (`2/2`) & Substitutions (`6/6`) Counters**:
  - Added courtside `+`/`-` controls in **Live Operator** (integrated into `undoLastAction` and auto-resetting on each new set), live indicator badges on **Arena TV (`/tv`)**, and persistent storage in `match_sets`.
- **Multi-Court Arena TV (`/tv`) Modes**:
  - Added auto-hiding top-bar switcher supporting **Single Court Focus**, **Dual Split-Screen (`Split 2`)**, and **Auto-Rotate (`12s`)**.
- **Optional Pool / Round-Robin Group Stage → Knockout Progression**:
  - Added `pool_knockout` category format, round-robin fixture generator (`Pool A..H`), FIVB standings calculator (`Wins` → `Match Points 3-2-1-0` → `Set Ratio` → `Point Ratio`), `PoolStandingsView`, and 1-click **Advance Pool Winners/Runners-Up to Main Bracket**.

### Changed
- **International Volleyball Broadcast Terminology (`src/shared/stages.ts`)**:
  - Standardized round, bracket, and scoreboard terminology across Portal, Bracket, Arena TV, Media Studio, and PDFs (`Pool Stage`, `Left Bracket` / `Right Bracket`, `Round of 16`, `Quarter-Final`, `Semi-Final`, `3rd Place Match`, `Grand Final`, `Champion`, `Runner-Up`, `Final Score`, `Set Score`) eliminating ambiguity between group-stage Pools and knockout bracket wings.

### Fixed
- **Origin-Clean Canvas Video/PNG Export with S3 Object Storage (`GET /api/public/asset-proxy`)**:
  - Added an SSRF-guarded same-origin CORS proxy (`/api/public/asset-proxy?url=...`), updated `/uploads/*` CSP headers, and added a `1×1` `getImageData` origin-clean verification gate in `MediaStudio` so `HTMLCanvasElement.captureStream()`, `toBlob()`, and `toDataURL()` never throw `SecurityError: Canvas is not origin-clean` when team/sponsor/brand logos are hosted on S3 buckets without CORS headers.

---

## [0.1.1] - 2026-11-18

### Added
- **Dashboard Password Management & Self-Service Security**:
  - Added `POST /api/auth/change-password` (rate-limited, verifies current Argon2id password) and `ChangePasswordModal` accessible to all authenticated roles (`admin`, `panitia`, `media`) from the Back-Office top bar and sidebar.
  - Added `PUT /api/auth/users/:id` and inline **Ubah Password / Edit** controls in **Manajemen Akun** (`/back-office/akun`) allowing administrators to reset any staff password, update display names/roles, and prevent accidental self-demotion.
  - Exposed Arena TV security PIN (`tvPin`) configuration directly inside **Branding & Logo** in addition to the Operator Console.
- **Category Deletion with Responsive Cascade Warning (`ConfirmDeleteCategoryModal`)**:
  - Added **Hapus Kategori** in **Kategori & Bagan** (`/back-office/turnamen`) guarded by a responsive confirmation dialog (centered modal on desktop, slide-up bottom sheet on mobile) detailing the exact count of teams, matches/schedules/scores, and gallery media that will be permanently removed, plus automatic S3/local asset cleanup on cascade delete.

---

## [0.1.0] - 2026-11-18

### Added
- **Real-Time Tournament & Rally Scoring Engine**:
  - Multi-category tournament management (`Best of 3` / `Best of 5`, configurable regular & deciding set targets, optional `2-point Deuce`, and per-match rule overrides).
  - Explicit set-point / match-point confirmation gate (`awaitingConfirm`), serving team indicator, set history tracking, and multi-action state undo.
- **Symmetric Knockout Bracket & Technical Meeting Draw**:
  - Dedicated `16-team` and `8-team` symmetric left/right bracket tree initialization alongside general `2–32` seeded bracket generation with automatic bye advancement.
  - Automatic winner progression to Finals and semifinal loser routing to Third-Place fixtures.
- **Adaptive Real-Time Synchronization (`SSE` + `ETag`)**:
  - Instant Server-Sent Events push (`/api/public/stream`) with configurable `MAX_SSE_CLIENTS` cap and automatic spectator fallback to lightweight `ETag` (`304 Not Modified`) polling.
  - Cloudflare `CF-Connecting-IP` / `X-Forwarded-For` real-IP awareness and Nginx reverse-proxy template (`deploy/nginx-openvolley.conf`).
- **PIN-Gated Arena TV Display (`/tv`)**:
  - Fullscreen `16:9` projector/LED scoreboard protected by constant-time PIN verification (`safeComparePin`) and dedicated VIP priority SSE stream (`/api/public/tv-stream`).
- **3-Role Back-Office (`/back-office`)**:
  - Role-separated workspace for `admin`, `panitia` (court officials), and `media` (broadcast crew) with responsive desktop sidebar and mobile bottom navigation.
- **Client-Side Broadcast Media Studio**:
  - Multi-ratio (`9:16`, `4:5`, `16:9`, `1:1`) high-resolution PNG poster and animated `MP4`/`WebM` broadcast video export powered by HTML5 Canvas, offscreen Three.js 3D volleyball rendering, and procedural WebAudio SFX.
  - Multi-photo (`1–3` photos) collage & diagonal-wipe video slideshow support plus in-browser single video trimmer (`2s–15s`) with original court audio mixing and smart S3 BGM auto-ducking.
  - Browser-first iPhone `.HEIC` / `.HEIF` photo normalization (`createImageBitmap` + lazy `heic2any` fallback) and `.MOV` QuickTime video verification (`@ffmpeg/ffmpeg` WebAssembly fallback).
  - Sponsor tiering (Top-3 Principal vs Supporting/Media Partner), optional white backing plate toggle, and automatic upcoming match schedule + court badges.
- **Multi-Slide & Video Moments Gallery**:
  - Swipeable multi-photo slide carousel, inline HTML5 video player, uncropped fullscreen lightbox modal, and S3-compatible object storage upload/cleanup with local `./data/uploads` fallback.
- **PWA, Accessibility & UI Polish**:
  - Installable Progressive Web App (`manifest.webmanifest`, network-safe `sw.js`, Android/Desktop install prompt + iOS Safari guide).
  - Seamless 1-icon 3-state theme toggle (`System` → `Opposite of OS` → `Explicit Same as OS` → `System`) with zero-flash external `/theme-init.js`.
  - Interactive 3D Matchday Sport Center hero (`VolleyballArena3D`) and verified WCAG 2.1 AA contrast ratios across Light and Dark themes.
  - Branded terminal startup banner displaying `localhost` and auto-detected LAN IPv4 addresses for instant mobile testing.
- **Security Hardening & Error Page Suite**:
  - Strict `Content-Security-Policy` without `'unsafe-inline'` in `script-src`, server/client plain-text & URL sanitizers (`sanitizePlainText`, `sanitizeHexColor`, `sanitizeAssetUrl`), magic-byte image/video verification, `HttpOnly` JWT cookies, and sliding-window brute-force rate limiting.
  - Complete branded error UI & HTTP status handling covering `400`, `401`, `403`, `404`, `408`, `429`, `500`, `502`, `503` (`MAINTENANCE_MODE`), `Offline`, and React `ErrorBoundary`.
- **DevOps, CI/CD & Documentation**:
  - Multi-stage Alpine `Dockerfile`, `docker-compose.yml`, GitHub Actions (`CI`, `CodeQL`, multi-arch `GHCR` Docker package publishing, and automated GitHub Releases), `CITATION.cff`, BibTeX metadata, GitHub Custom Properties schema, and English documentation suite under `docs/`.

[Unreleased]: https://github.com/ardianryan/OpenVolley/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ardianryan/OpenVolley/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ardianryan/OpenVolley/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ardianryan/OpenVolley/releases/tag/v0.1.0

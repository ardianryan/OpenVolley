# Changelog

All notable changes to **OpenVolley** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.2] - 2026-11-27

### Added
- **Scorer Local Court-Side Switch (`LiveOperator.tsx`)**:
  - Added a **Tukar Posisi (Kiri ↔ Kanan)** toggle bar directly above the live scoreboard cards so court referees/scorers can flip left/right card positions on their device when teams switch courts, without altering `teamA`/`teamB` data in the database or on Arena TV / OBS displays.
  - Added clear **`Lap. Kiri`** / **`Lap. Kanan`** badges per card, a **`2 Kolom HP`** compact side-by-side layout toggle for mobile portrait devices, `localStorage` persistence per match, and automatic non-blocking switch reminders on new sets or at point 8 in a deciding set.
- **Cinematic 3-Act Bracket Template (`MediaStudio.tsx`, `media-timeline.ts`)**:
  - Added **`BAGAN / BRACKET`** template in Media Studio with symmetric Left (Pool A), Right (Pool B), and Grand Final / 3rd Place views (`auto_tour`, `left`, `right`, `finals`, `full`), progressive neon-gold connector lines, team logos, and animated navy-gold arena backdrop (exportable as PNG, IG Pack, or Video MP4 even without uploaded media).
  - Added `minScene4HoldSec` support in `computeMediaTimeline` (`11.4s` minimum hold for 3-Act `auto_tour`) while capping total video duration at 60 seconds.
- **Non-Match Media Studio Templates & Intro Toggle (`MediaStudio.tsx`)**:
  - Added 4 schedule-free broadcast templates: **`FRAME POLOS`** (`clean_frame`), **`CEREMONY / BOOTH`** (`event_moment`), **`TATA TERTIB`** (`venue_rules`), and **`PENGUMUMAN`** (`announcement`).
  - Added an **Intro Pembuka 3D** toggle (`includeIntro`) and expanded maximum video clip / total export duration to 60 seconds (`MAX_VIDEO_CLIP_SEC = 60.0`).
- **Multi-Slide Daily Schedule with Team Logos (`MediaStudio.tsx`)**:
  - Upgraded **`JADWAL HARIAN`** (`schedule_day`) to paginate up to 4 matches per slide with team logos and automatic slide transitions in Video mode, skipping the single-matchup Scene 3 card.

### Fixed
- **>15s Video Playback & Export Freeze (`MediaStudio.tsx`)**:
  - Fixed video freezing around ~15 seconds during Preview & Video Export by replacing the hardcoded `7.48s` gate in `syncHiddenVideoAt` with dynamic `timeline.scene4StartSec` tracking (included in `useCallback` dependencies) and adding a `2000ms` resync cooldown (`lastVideoResyncAtRef`) with a `> 2.5s` drift threshold to prevent keyframe seek-loops.
- **Social Media MP4 Export Compatibility (`MediaStudio.tsx`)**:
  - Improved MP4 transcoding compatibility for social media uploads (Instagram/TikTok/WhatsApp).

---

## [0.3.1] - 2026-11-19

### Added
- **Visual Trimmer Sequence & Filmstrip Scrubber (`VideoTrimmerControl.tsx`, `media-timeline.ts`)**:
  - Replaced numerical duration-based trimming with a WhatsApp / video-editor style interactive scrubber bar.
  - Interactive drag handles with millisecond precision, real-time seek preview, clamped trim window (2s–15s), and duration / aspect-ratio badges.
- **Gesture Direct Crop & Pinch-to-Zoom (`MediaCropBox.tsx`, `media-framing.ts`)**:
  - Implemented intuitive gesture-based media framing: 1-finger / mouse drag, 2-finger pinch-to-zoom, non-passive mouse wheel / trackpad zoom, and double-click reset for photo covers and collage slots.
  - Rule-of-thirds 3x3 alignment grid and compact zoom pill bar (`-`, zoom %, `+`, reset, done) replacing unintuitive range sliders.
- **Expanded Audio Library for Pre-Match Upcoming Scenes (`audio-library.ts`)**:
  - Added 5 new high-energy BGM tracks (`Warmup Rhythm & Spikes`, `Rivalry Countdown`, `Morning Court Kickoff`, `Arena Pulse & Hype`, `Locker Room Focus`) hosted on S3 CDN storage, enriching the upcoming template pool to 9 tracks.
- **Mobile Bottom Navigation & OBS Broadcast Enhancements**:
  - Compact thumb-accessible mobile bottom navigation bar with active route indicators and grouped shortcuts.
  - OBS Broadcast transitions, stinger bumpers, brand strip, and dedicated dock/Lua plugin integration.

### Fixed
- **Match Reset & Bracket Advancement Retraction (`bracket.ts`, `scoring.ts`, `LiveOperator.tsx`)**:
  - Fixed an issue where resetting a completed match left the winning team in downstream bracket matches (e.g., SMPN 6 remaining in Quarter Final after R16 match reset).
  - Implemented `retractAdvancement(matchId)` which cleanly clears qualified team slots in downstream matches (`nextMatchId` and `loserNextMatchId`) and cascades recursively.
  - Integrated retraction into `resetMatchScore`, `undoLastAction`, `finishMatchManually`, and `addExtraSet`.
  - Added explicit **"Reset Permainan"** controls in Live Operator with informative confirmation dialog and real-time SSE broadcasts.
- **Media Studio Video Export Frame Flicker (`MediaStudio.tsx`)**:
  - Resolved canvas flickering during 60fps MP4/WebM video export by maintaining persistent offscreen video buffer rendering.

---

## [0.3.0] - 2026-11-19

### Added
- **Token-Gated OBS Browser Source Overlay & Back-Office Controller (`/obs?token=<secret>`)**:
  - Dedicated transparent browser source overlay (`ObsOverlayDisplay.tsx`) with 100% transparent alpha canvas and 5 broadcast layout presets: **Scorebug Corner**, **Lower-Third Bar**, **Match Intro VS**, **Timeout / Set Break**, and **Winner Card**.
  - Token-gated stream endpoints (`/api/public/obs-stream`, `/api/public/obs-state`) with constant-time token validation and 1-click token regeneration from the Back-Office.
  - Remote OBS Controller panel at `/back-office/obs` with real-time match selection, layout switching, theme selection (Dark, Broadcast Glass, High-Contrast), and visibility toggles.
- **FIVB Form O-2 Official Scoresheet Generator (`OfficialDocuments.tsx`, `pdfDocuments.ts`)**:
  - Automated generation of official FIVB Form O-2 vector PDF scoresheets containing team rosters, starting lineups, set duration timestamps (`startedAt`, `endedAt`), per-set timeouts, substitutions, and referee sign-off blocks.
  - Dedicated `O-2` action button on the Official Documents match list.
- **Full Bilingual UI Localization (`i18n.ts`)**:
  - Typed Indonesian (`id`) and English (`en`) localization dictionary with persistent local storage preferences (`openvolley_locale`).
  - Seamless language toggle button (`ID / EN`) directly in the header of the Public Portal.
- **Outgoing Webhooks & Hot S3 Database Backup (`/back-office/integrasi`)**:
  - HMAC-SHA256 signed outgoing webhook dispatcher (`webhook.ts`) with anti-SSRF IP filtering (blocking loopback, private ranges, metadata IPs) and automated delivery on `match_started`, `set_finished`, and `match_finished` events.
  - Hot SQLite database backup (`VACUUM INTO`) to S3-compatible object storage with 1-click manual trigger and direct backup downloads.
- **Master Court Schedule Editing & Clearing (`ScheduleCourtsManager.tsx`)**:
  - Interactive modal dialog to edit match date/time (`scheduledAt`), court assignment (`courtName`), and stage labels with 1-click quick time slot buttons (`07.30 - 08.45`, `08.45 - 10.00`, etc.).
  - Per-match schedule clearing / unassigning with confirmation dialog.
  - Whole-court bulk schedule clearing (`POST /api/admin/matches/bulk-schedule-clear`) to reset all time slots on a specific court.
  - Collapsible drawer for unscheduled matches with 1-click scheduling action.
- **Skippable 3rd Place Match & Joint 3rd Place ("Juara 3 Bersama")**:
  - Unified `resolveTournamentPodium` engine in `src/shared/podium.ts`. When `hasThirdPlace: false`, both semifinal losers are officially recognized as Joint 3rd Place winners (*Juara 3 Bersama*), and 4th place is cleanly omitted.
  - Interactive Bracket View displays a dedicated **"JUARA 3 BERSAMA"** card and updated podium recap.
  - Media Studio *Champions & Podium* template automatically displays both semifinal losers on the 3rd place podium.
  - Tournament Bulletin PDF automatically draws a *"JUARA 3 BERSAMA"* box with both school names.
  - Category rules editor allows toggling 3rd place playoff on/off dynamically before or after bracket generation.
- **Cloud S3 Logo Storage & Auto-Migration (`src/server/db/index.ts`)**:
  - Synced all 16 school emblems and master contingent logos to S3 bucket CDN (`https://is3-storage.smage.my.id/svc-media/logos/`).
  - Runtime database boot migration automatically rewrites legacy local disk paths (`/uploads/logos/...`) to public S3 URLs when S3 is enabled.
- **Cloudflare Turnstile Bot Gate (`src/client/components/TurnstileGate.tsx`)**:
  - Integrated Cloudflare Turnstile bot verification on public portal entry and back-office authentication forms with theme matching.

---

## [0.2.1] - 2026-11-18

### Added
- **Master Contingents Registry (`/back-office/kontingen`) & Non-Destructive Auto-Migration**:
  - Centralized `master_teams` table (`name`, `shortCode`, `school`, `level`, `logoUrl`, `color`, `defaultCoachName`, `defaultManagerName`, `defaultJerseyColors`) shared across `SMP/MTs`, `SMA/SMK/MA`, `Kab/Kota`, and `Klub/Umum` divisions.
  - Direct Tab-separated (`No \t Nama Sekolah \t Kab/Kota`) & Pipe-separated bulk import from Google Sheets/Excel (`POST /api/admin/master-teams/bulk`) with header/duplicate skipping and automatic level inference.
  - Automatic identity & logo synchronization across linked category entries (`teams.master_team_id`) while preserving per-category coach, manager, and jersey overrides.
  - Safe shared-logo reference counting (`safeDeleteTeamLogoIfUnreferenced`) so deleting one division preserves shared Master Contingent emblems.
- **Hybrid FIVB Technical Meeting (TM) Drawing & Live Bagan / TM Mode**:
  - Searchable draw-slot combobox (`SearchableTeamPicker`) directly on `4 / 8 / 16 / 32` TM bracket slots (`PUT /api/admin/tournaments/:id/draw-slot`) with duplicate guards, secondary squad support (`+ Tim B`), and inline `+ Simpan Baru ke Master`.
  - FIVB Smart Auto-Draw engine (`src/shared/fivb-draw.ts`) supporting seeded opposite-wing locking (`isSeeded`), Serpentine Snake Pool seeding, and Round-1/Pool anti-same-region separation (`separateSameRegion`).
  - Live `draw_slot_updated` SSE broadcasts driving gold reveal spotlight banners & slot highlights on `/tv` and `/bagan` without page refresh.
- **Master Courts & Visual Cross-Court Schedule Board (`/back-office/jadwal`)**:
  - Centralized `master_courts` registry with cascading court renames (`PATCH /api/admin/master-courts/:id`) synced to schedules and `LiveOperator`.
  - Side-by-side cross-court schedule board (`ScheduleCourtsManager`) featuring 1-click **"Tarik Jadwal"** transfers between courts, chronological day sorting, and **"Salin Pola Jam"** time-slot copying (`POST /api/admin/matches/bulk-schedule-assign`).
- **Multi-Screen Remote TV Controller & Dynamic Standby Banners (`/back-office/layar-tv`)**:
  - Dedicated `tv_screens` profile table (`/tv?screen=<slug>`) centrally controlled by admins/officials over real-time `tv_screen_updated` SSE (`1 Lapangan`, `Split 2`, `Auto 12d`, `Bagan / TM`, and `Standby Banner`).
  - Clean display-only `/tv` header (no manual TV-side mode switchers or internal profile pill clutter).
  - Fullscreen Dynamic Standby Banner renderer supporting quick presets (**Technical Meeting**, **Warm-Up Arena**, **Istirahat / Jeda**, **Next Match**, **Kustom Bebas**), live WIB digital clock, optional custom backdrop upload, sponsor footer, and continuous CSS running-text marquee (`animate-tv-marquee`).
- **Public Portal TV Visibility Gate (`publicTvEnabled`)**:
  - Hides the `Layar Skor TV` CTA button on the public homepage (`VolleyballArena3D`) by default (`publicTvEnabled: false`) while preserving TV PIN protection; admins can toggle public visibility in **Branding & Logo**.
- **Chronological Per-Day PDF Schedule Grouping & Accordion Back-Office Sidebar**:
  - Day-by-day chronological schedule sections (`src/shared/schedule.ts` → `HARI 1..N`) with column headers and compact bracket schedule strips in Bulletin PDFs.
  - Smooth CSS-Grid collapsible accordion sidebar groups in `BackOffice` (default collapsed, expanding automatically for the active menu category).
- **Comprehensive Granular RBAC & Custom Roles (`/back-office/users`)**:
  - Dedicated `roles` database table with immutable/protected system roles (`admin`, `panitia`, `media`) and full CRUD for custom roles (`GET/POST/PUT/DELETE /api/auth/roles`) with checkbox-driven permission selection across all 12 Back-Office menus (`src/shared/rbac.ts`).
  - Per-user granular menu permission overrides (`users.permissions_json`, `null` inherits role defaults) editable directly when creating or updating staff accounts (`UserRolesManager.tsx`).
  - Dynamic default landing route (`getDefaultLandingSection`) so staff without `overview` automatically land on their first allowed Back-Office module.

### Changed
- **3-Step Live Operator UX Wizard (`src/client/pages/LiveOperator.tsx`)**:
  - Rebuilt the live scoring console into a focused 3-step workflow: **1. Pilih Lapangan** -> **2. Pilih Jadwal Aktif** -> **3. Konsol Skor Live**.
  - Removed redundant `PIN TV` / `Set` inputs and `Layar TV ↗` links now handled centrally by `/back-office/layar-tv`, and added `Escape`-key handling on confirmation modals.
- **Media Studio Visual Polish (`src/client/pages/MediaStudio.tsx`)**:
  - Upgraded lighting to ReactBits-inspired volumetric top-center `LightRays`, dual symmetric diagonal shutter transitions with full clearance, `warmUpGpuTextures()` + `img.decode()` pre-warming prior to recording, `drawContainedCanvasImage()` aspect-ratio preservation, and proportionally larger (`~2×`) school crests on score cards & VS doors.
- **PDF & OG Partner Badge Aspect Preservation (`src/client/lib/pdfDocuments.ts`, `src/server/services/ogImage.ts`)**:
  - Added `loadRasterAsset()` alpha bounding-box auto-trimming + `addContainedImage()` and adaptive dark-slate contrast badges so wide horizontal gold wordmarks (e.g. `AVERSA`) retain natural aspect ratios without clipping.
- **Anti-Slop UI & Accessibility Refinements**:
  - Replaced native `window.confirm` popups across `MasterTeamsManager.tsx`, `ScheduleCourtsManager.tsx`, and `TvScreensManager.tsx` with a themed accessible `ConfirmDialog` component (`Escape` close, `>=44px` mobile buttons).
  - Enlarged mobile action icon tap targets (`min-h-11 min-w-11 sm:min-h-8 sm:min-w-8`), replaced generic `Sparkles` placeholders with `LayoutTemplate`, and cleaned em-dash punctuation from TV UI copy.

### Fixed
- **RBAC & Security Hardening (`src/server/middleware/auth.ts`, `src/server/routes/admin.ts`, `src/server/routes/media.ts`, `src/server/app.ts`, `src/server/services/upload.ts`)**:
  - Enforced real-time database session & role permission verification (`resolveLiveAuthUser`, `requirePermission`) on every protected request so deleted or demoted accounts are rejected immediately (`401`/`403`) rather than trusting stale JWT claims.
  - Applied granular `requirePermission(...)` guards across `/api/admin/*` and `/api/media/*` endpoints and redacted `tvPin` from `/api/admin/overview` unless the caller holds `branding` or `tv_screens` permissions.
  - Sanitized `resolveRequestOrigin()` against forged `X-Forwarded-Host` / `Host` header injection (with optional `PUBLIC_ORIGIN` override) and tightened `deleteUploadedImage()` local path validation via strict allowlist regex.
- **Zero-Delay VIP TV SSE & Instant Final-Set Match Ending (`src/server/routes/public.ts`, `src/server/services/sse.ts`, `src/server/services/scoring.ts`)**:
  - Applied `no-cache, no-store, no-transform, must-revalidate` and `X-Accel-Buffering: no` headers directly onto Hono `streamSSE()` `Response` objects to defeat reverse-proxy buffering.
  - Replaced sequential SSE loops with concurrent non-blocking `Promise.allSettled` fan-out + `2500ms` write timeout & stalled-socket eviction so slow mobile viewers never block VIP TVs or scoring updates.
  - Updated `finishMatchManually` to close and count active non-zero sets so `/tv` transitions immediately (`0ms`) to the final set & winner summary without refresh.

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

[Unreleased]: https://github.com/ardianryan/OpenVolley/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/ardianryan/OpenVolley/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ardianryan/OpenVolley/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ardianryan/OpenVolley/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ardianryan/OpenVolley/releases/tag/v0.1.0

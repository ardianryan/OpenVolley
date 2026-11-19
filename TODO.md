# OpenVolley Engineering Roadmap & TODO

This document tracks completed milestones in **`v0.1.0` – `v0.2.1`** alongside the prioritized engineering backlog for upcoming releases.

---

## Completed in `v0.1.0` (Foundation Release)

### Core Tournament & Scoring Engine
- [x] Multi-category tournament CRUD (`Putra`, `Putri`, custom divisions) with `Best of 3` / `Best of 5` and configurable set targets (`25`/`15`).
- [x] Per-match rule overrides (`bestOf`, `regularSetPoints`, `decidingSetPoints`, `useDeuce`).
- [x] Explicit set-point / match-point confirmation guard (`awaitingConfirm`) to eliminate accidental tap errors courtside.
- [x] Multi-action scoring undo stack (`undoLastAction`) capable of reverting confirmed set transitions.
- [x] Symmetric `16-team` and `8-team` Technical Meeting draw generator + arbitrary `2–32` seeded bracket builder with auto-byes and Third-Place match routing.

### Real-Time Delivery & Venue Surfaces
- [x] Adaptive SSE broadcast (`/api/public/stream`) with configurable `MAX_SSE_CLIENTS` ceiling and automatic `ETag` (`304`) polling fallback.
- [x] PIN-gated Arena TV Display (`/tv`) with dedicated VIP SSE channel (`/api/public/tv-stream`) and constant-time PIN verification.
- [x] Installable PWA (`manifest.webmanifest`, API-safe `sw.js`, Android/Desktop install trigger + iOS Safari installation sheet).
- [x] Seamless 1-icon 3-state theme button (`System` → `Opposite of OS` → `Explicit Same` → `System`) + WCAG 2.1 AA contrast compliance.
- [x] Terminal startup banner printing `localhost` and auto-detected LAN IPv4 addresses for instant mobile testing.

### Broadcast Media Studio & Moments Gallery
- [x] Multi-ratio (`9:16`, `4:5`, `16:9`, `1:1`) PNG poster and animated `MP4`/`WebM` broadcast video export.
- [x] Offscreen Three.js 3D volleyball rendering, S3 CDN soundtrack pool (`18` normalized tracks), procedural transition SFX, and smart BGM auto-ducking.
- [x] Multi-photo (`1–3` photos) collage/slideshow + in-browser video trimmer (`2s–15s`) with original court audio controls.
- [x] Automatic browser-side iPhone `.HEIC` photo and `.MOV` QuickTime video normalization.
- [x] Multi-slide photo carousel, inline HTML5 video player, and uncropped fullscreen Lightbox in the Moments Gallery.

### Security, Reliability & DevOps
- [x] Strict `Content-Security-Policy` (no `'unsafe-inline'` scripts), server/client anti-XSS sanitizers, magic-byte image/video upload validation, and `HttpOnly` JWT cookies.
- [x] Full branded error page suite (`400`, `401`, `403`, `404`, `408`, `429`, `500`, `502`, `503` maintenance mode, `Offline`, `ErrorBoundary`).
- [x] Multi-stage Alpine `Dockerfile`, `docker-compose.yml`, GitHub Actions (`CI`, `CodeQL`, multi-arch `GHCR` packages, automated GitHub Releases).

---

## Completed in `v0.2.0` (Matchday Operations, Dynamic Branding/SEO & Official Publications)
- [x] **Dynamic Favicon, Server SEO Injector & Auto Social Image (`1200×630` PNG):** Default `/brand/svc-crest-color.svg` favicon synced to `siteSettings.logoUrl`, server HTML meta injection, and `@resvg/resvg-wasm` social preview card at `GET /api/public/og-image.png`.
- [x] **Official Vector PDF Suite & "Dokumen Resmi" Hub:** Lazy-loaded `jspdf` **Tournament Bulletin PDF** (Cover + Contingent/Pool Cards + Schedule/Standings + Vector Main Bracket) and 1-page A4 **Official Match Summary PDF**, plus Admin `ON/OFF` public download toggle.
- [x] **Media Studio Champions/Podium & Stage Visual Themes:** Dedicated `CHAMPIONS & PODIUM` (`1st`, `2nd`, `3rd`, `Official Podium 1-2-3`) template + `Quarter-Final`, `Semi-Final`, `3rd Place Match`, and `Grand Final` stage themes, standardized on international FIVB terminology, plus SSRF-safe `/api/public/asset-proxy` preventing S3 canvas tainting.
- [x] **Pool / Round-Robin Group Stage → Knockout Progression:** FIVB `3-2-1-0` standings calculator, round-robin fixture generator, `PoolStandingsView`, and 1-click knockout advancement.
- [x] **Per-Set Timeouts (`2/2`) & Substitutions (`6/6`) Counter:** Courtside controls with `undoLastAction` support and Arena TV indicators.
- [x] **Multi-Court Arena TV (`/tv`):** Single-Court Focus, Dual Split-Screen (`Split 2`), and `12s` Auto-Rotate modes.

---

## Completed in `v0.2.1` (Master Registries, Hybrid FIVB TM Draw, Remote Multi-TV & Granular RBAC)
- [x] **Master Contingents Registry (`/back-office/kontingen`):** Shared club/school/region registry (`master_teams`) with Google Sheets Tab-bulk import, level tags (`SMP/MTs`, `SMA/SMK/MA`, `Kab/Kota`, `Umum`), automatic multi-division identity propagation, and non-destructive migration from existing teams.
- [x] **Hybrid FIVB Technical Meeting Draw & Live Bagan SSE:** Searchable draw-slot comboboxes (`SearchableTeamPicker`), `+ Tim B` secondary squads, seeded opposite-wing locking, Round-1 anti-same-region separation, and real-time `draw_slot_updated` highlight banners on `/tv` and `/bagan`.
- [x] **Master Courts & Visual Schedule Board (`/back-office/jadwal`):** Centralized court CRUD with cascading renames, 1-click **"Tarik Jadwal"** transfers across courts, and **"Salin Pola Jam"** time-slot copying.
- [x] **Remote Multi-TV Controller & Dynamic Standby Banners (`/back-office/layar-tv`):** Multiple TV screen profiles (`/tv?screen=<slug>`) controlled remotely over VIP SSE (`tv_screen_updated`), clean display-only `/tv` chrome, customizable Standby Banner presets (`TM`, `Warm-Up`, `Break`, `Next Match`, `Custom`) with WIB digital clock & running marquee, and default-hidden public `/tv` CTA toggle (`publicTvEnabled`).
- [x] **Comprehensive Granular RBAC & Custom Roles (`/back-office/users`):** Custom role CRUD (`roles` table protecting system `admin`/`panitia`/`media`), per-user checkbox permission overrides (`users.permissions_json`), real-time database session/permission enforcement (`requireAuth` & `requirePermission`), and automatic landing routing.
- [x] **3-Step Live Operator Wizard & Security/Anti-Slop Hardening:** Rebuilt `/back-office/operator` into `Pilih Lapangan -> Pilih Jadwal Aktif -> Konsol Skor Live` without `PIN TV` clutter; hardened `Host` header parsing, `tvPin` redaction, upload path deletion regex, accessible `<ConfirmDialog>` modals, and `>=44px` mobile tap targets.
- [x] **Zero-Delay SSE & Polish:** Non-blocking concurrent SSE fan-out (`2500ms` socket timeout), proxy-proof `streamSSE` headers, instant finished-match final-set transitions, per-day Bulletin PDF schedule grouping, aspect-preserved `AVERSA`/school logos, ReactBits volumetric `LightRays` + GPU texture pre-warming in Media Studio, and collapsible accordion sidebar groups.

---

## Completed in `v0.3.0` (Broadcast Graphics, FIVB O-2 Scoresheet, Webhooks & Full Localization)
- [x] **Token-Gated OBS Browser Source Overlay & Back-Office Remote Controller:**
  - Dedicated `/obs?token=<secret>` broadcast overlay with 100% transparent alpha canvas and 5 dynamic layout presets: Scorebug Corner, Lower Third Bar, Pre-match VS Intro, Timeout/Set Break, and Winner Card.
  - Back-office controller at `/back-office/obs` with token regeneration, visibility toggle, theme switching, and real-time SSE stream (`/api/public/obs-stream`).
- [x] **FIVB Form O-2 Official Scoresheet Generator:**
  - Standardized FIVB Form O-2 scoresheet PDF with player rosters, starting lineups, set durations, timeouts, substitutions, and referee sign-offs in `pdfDocuments.ts`.
- [x] **Full Bilingual UI Localization (Indonesian & English):**
  - Type-safe dictionary `i18n.ts` supporting `id` and `en` with persistent local storage preference and switcher on Public Portal.
- [x] **Integrations & S3 Backup:**
  - HMAC-SHA256 signed, anti-SSRF webhook dispatcher (`webhook.ts`).
  - Hot SQLite database backup (`VACUUM INTO`) to S3 storage with manual trigger and download at `/back-office/integrasi`.
- [x] **Court Schedule Management (Edit & Clear Schedules):**
  - Interactive schedule edit modal with quick time-slot shortcuts (`07.30 - 08.45`, etc.), court switching, and stage label editor.
  - Per-match schedule clearing (unschedule) and whole-court bulk schedule reset with safe confirmation dialogs.
  - Collapsible drawer for unscheduled matches.
- [x] **Skippable 3rd Place Match & Joint 3rd Place ("Juara 3 Bersama"):**
  - Option to skip 3rd place playoff match (`hasThirdPlace: false`), automatically recognizing both semifinal losers as Joint 3rd Place winners.
  - Reflected across Bracket View, Official Podium Recap, Media Studio posters/videos, and PDF Bulletins.
- [x] **School Logo S3 Cloud Storage & Auto-Migration:**
  - All 16 official school logos synced to S3 bucket (`svc-media/logos/`).
  - Automatic migration on server boot to update legacy local `/uploads/logos/` paths to S3 public URLs when S3 is enabled.

---

## Upcoming Backlog

### `v0.3.1` — Analytics & Live Venue Enhancements
- [x] **FIVB Official Scoresheet (Form O-2 & Line-Up Sheet):** Optional court-table O-2 PDF export with player roster & jersey numbers, starting rotations (Positions I–VI) per set, Libero tracking, point-by-point running score, sanction cards, set duration timestamps, and Match No. in Match Summary.
- [x] **UI Localization Dictionary (`i18n`):** Pluggable locale pack (`id-ID` default + `en-US` toggle) for international tournaments.
- [x] **OBS Browser Source Overlay (`/obs?overlay=...&token=...`) & Remote Controller (`/back-office/obs`):** Transparent-background OBS Browser Source protected by per-profile access tokens, 5 broadcast layout variations (`scorebug_corner`, `lower_third`, `match_intro`, `timeout_break`, `winner_card`), and real-time SSE controller.
- [x] **Outbound Webhooks:** Signed JSON webhooks (`HMAC-SHA256` + anti-SSRF guard) on `match_started`, `set_confirmed`, and `match_finished` for Discord, Telegram, or generic endpoints.
- [x] **Automated SQLite Snapshot Backup:** Scheduled & manual hot backup (`VACUUM INTO`) to S3-compatible storage.

### `v1.0.0` — Federation & Multi-Event Scale
- [ ] **Multi-Season Archive Mode:** Read-only historical tournament archive per year/edition (`2026`, `2027`, etc.) with persistent team records.
- [ ] **Roster & Player Jersey Registry:** Optional player lineups, libero badge, and MVP / Top Scorer award cards in Media Studio.
- [ ] **Offline Optimistic Operator Queue:** IndexedDB rally queue on the court tablet to survive brief Wi-Fi drops and replay rallies upon reconnection.

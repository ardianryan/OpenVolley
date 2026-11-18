# OpenVolley Engineering Roadmap & TODO

This document tracks completed milestones in **`v0.1.0` – `v0.2.0`** alongside the prioritized engineering backlog for upcoming releases.

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

## Upcoming Backlog

### `v0.3.0` — Integrations & Full Localization
- [ ] **UI Localization Dictionary (`i18n`):** Pluggable locale pack (`id-ID` default + `en-US` toggle) for international tournaments.
- [ ] **OBS Browser Source Overlay (`/obs/:matchId`):** Transparent-background lower-third scorebug URL for live YouTube / Twitch match streams.
- [ ] **Outbound Webhooks:** Signed JSON webhooks on `match_started`, `set_confirmed`, and `match_finished` for Discord, Telegram, or WhatsApp bots.
- [ ] **Automated SQLite Snapshot Backup:** Scheduled hot backup (`VACUUM INTO`) to S3-compatible storage.

### `v1.0.0` — Federation & Multi-Event Scale
- [ ] **Multi-Season Archive Mode:** Read-only historical tournament archive per year/edition (`2026`, `2027`, etc.) with persistent team records.
- [ ] **Roster & Player Jersey Registry:** Optional player lineups, libero badge, and MVP / Top Scorer award cards in Media Studio.
- [ ] **Offline Optimistic Operator Queue:** IndexedDB rally queue on the court tablet to survive brief Wi-Fi drops and replay rallies upon reconnection.

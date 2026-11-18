# OpenVolley Engineering Roadmap & TODO

This document tracks completed milestones in **`v0.1.0`** alongside the prioritized engineering backlog for upcoming releases.

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

## Upcoming Backlog

### `v0.2.0` — Matchday Operations & Analytics
- [ ] **Pool / Round-Robin Group Stage:** Optional group-stage standings table (`Points`, `Set Ratio`, `Point Ratio` per FIVB tie-breaker rules) feeding into knockout brackets.
- [ ] **Timeouts & Substitutions Counter:** Optional per-set timeout (`2/2`) and player substitution counters on the Operator Console and Arena TV bug.
- [ ] **Official Match Summary PDF:** One-click printable A4 match result sheet with set durations, set scores, and referee signature blocks.
- [ ] **Multi-Court Arena TV Carousel:** Optional auto-rotating or split-screen dual-court view on `/tv` for venues running Court 1 and Court 2 simultaneously.

### `v0.3.0` — Integrations & Internationalization
- [ ] **UI Localization Dictionary (`i18n`):** Pluggable locale pack (`id-ID` default + `en-US` toggle) for international tournaments.
- [ ] **OBS Browser Source Overlay (`/obs/:matchId`):** Transparent-background lower-third scorebug URL for live YouTube / Twitch match streams.
- [ ] **Outbound Webhooks:** Signed JSON webhooks on `match_started`, `set_confirmed`, and `match_finished` for Discord, Telegram, or WhatsApp bots.
- [ ] **Automated SQLite Snapshot Backup:** Scheduled hot backup (`VACUUM INTO`) to S3-compatible storage.

### `v1.0.0` — Federation & Multi-Event Scale
- [ ] **Multi-Season Archive Mode:** Read-only historical tournament archive per year/edition (`2026`, `2027`, etc.) with persistent team records.
- [ ] **Roster & Player Jersey Registry:** Optional player lineups, libero badge, and MVP / Top Scorer award cards in Media Studio.
- [ ] **Offline Optimistic Operator Queue:** IndexedDB rally queue on the court tablet to survive brief Wi-Fi drops and replay rallies upon reconnection.

# Changelog

All notable changes to **OpenVolley** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- Optional multi-court simultaneous split-screen mode on Arena TV (`/tv`).
- Exportable official match scoresheet PDF summary per completed fixture.
- Optional Webhook / Discord / Telegram match-result notifications.

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

[Unreleased]: https://github.com/ardianryan/OpenVolley/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ardianryan/OpenVolley/releases/tag/v0.1.0

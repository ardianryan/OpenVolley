# HTTP REST & SSE API Reference

All API endpoints are served under `/api/*` and return UTF-8 JSON (except SSE streams and `304 Not Modified` responses). Unknown `/api/*` paths return `404` JSON.

---

## 1. Public Spectator & Arena TV Endpoints (`/api/public`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/public/health` | Public | Liveness & telemetry check (`ok`, `sseClients`, `maxSseClients`, `overviewVersion`). Always remains `200` even when `MAINTENANCE_MODE=true`. |
| `GET` | `/api/public/overview` | Public | Complete public state (`settings`, `tournaments`, `teams`, `matches`, `reports`). Supports `ETag` / `If-None-Match` (`304 Not Modified`). Note: `tvPin` is stripped from public responses. |
| `GET` | `/api/public/og-image.png` | Public | Auto-generated `1200×630` PNG social share card rendered from active `siteSettings` and bundled fonts via `@resvg/resvg-wasm` (supports `ETag` `304`). |
| `GET` | `/api/public/asset-proxy` | Public | SSRF-guarded same-origin CORS proxy (`?url=...`) restricted strictly to configured S3 buckets, persisted tournament logos/sponsors, and official audio tracks so Canvas `captureStream()` / `toBlob()` stays origin-clean. |
| `GET` | `/api/public/matches/:id` | Public | Detailed match state with per-set scores and associated `match_reports`. |
| `GET` | `/api/public/stream` | Public | Public Server-Sent Events stream (`connected`, `score_update`, `overview_changed`, `report_added`, `report_deleted`). Returns `503` if `MAX_SSE_CLIENTS` is reached so clients switch to ETag polling. |
| `GET` | `/api/public/tv-check` | Public | Checks whether the caller holds a valid `ov_tv_vip` or `admin`/`panitia` session cookie. |
| `POST` | `/api/public/tv-auth` | Rate-Limited | Verifies `{ "pin": "4426" }` using constant-time comparison and sets the `HttpOnly` `ov_tv_vip` cookie. |
| `GET` | `/api/public/tv-stream` | TV VIP / Staff | Priority SSE stream reserved for authenticated Arena TV displays. |

---

## 2. Authentication & User Management (`/api/auth`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Rate-Limited | Authenticates `{ "username", "password" }` and sets the `HttpOnly` `ov_token` JWT cookie (`7-day` TTL). Returns `429` + `Retry-After` after `8` failed attempts in `5` minutes. |
| `POST` | `/api/auth/logout` | Public | Clears the `ov_token` cookie. |
| `GET` | `/api/auth/me` | Authenticated | Returns the active user profile (`id`, `username`, `name`, `role`). |
| `POST` | `/api/auth/change-password` | Authenticated + Rate-Limited | Self-service password update (`{ "currentPassword", "newPassword" }`, min. 6 chars) for any logged-in user (`admin`, `panitia`, `media`). |
| `GET` | `/api/auth/users` | `admin` | Lists all registered staff accounts (without password hashes). |
| `POST` | `/api/auth/users` | `admin` | Creates a new staff account (`role`: `'admin' \| 'panitia' \| 'media'`). |
| `PUT` | `/api/auth/users/:id` | `admin` | Updates account display `name`, `role`, or resets `password` (blocks self-demotion of the active admin). |
| `DELETE` | `/api/auth/users/:id` | `admin` | Deletes a staff account (prevents self-deletion of the active admin). |

---

## 3. Tournament, Bracket, Scoring & Branding (`/api/admin`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/overview` | `admin`, `panitia`, `media` | Full tournament state including administrative fields (`tvPin`, undo depth). |
| `PUT` | `/api/admin/settings` | `admin` | Updates event name, subtitle, metadata, `seoDescription`, `publicDocsEnabled`, `docSettingsJson`, accent color, and logo/social resets. |
| `PUT` | `/api/admin/settings/docs` | `admin`, `panitia` | Updates official Bulletin & Match Summary metadata (`docSettings`); `admin` may also toggle `publicDocsEnabled`. |
| `POST` | `/api/admin/settings/doc-cover` | `admin`, `panitia` | Uploads a custom A4 Bulletin cover image (`multipart/form-data`). |
| `POST` | `/api/admin/settings/logo` | `admin` | Uploads brand/social images (`main`, `coBrand`, `organizer`, `social`, `docCover`) via `multipart/form-data`. |
| `POST` | `/api/admin/settings/sponsors` | `admin` | Uploads a sponsor or media partner (supports light/dark logos and `boxed` plate flag). |
| `PUT` | `/api/admin/settings/sponsors/reorder` | `admin` | Reorders sponsor priority (first 3 entries render as Top-3 Principal tier). |
| `DELETE` | `/api/admin/settings/sponsors/:id` | `admin` | Deletes a sponsor entry. |
| `POST` | `/api/admin/tournaments` | `admin`, `panitia` | Creates a tournament division (`bestOf`, `regularSetPoints`, `decidingSetPoints`, `useDeuce`, `hasThirdPlace`). |
| `PUT` | `/api/admin/tournaments/:id` | `admin`, `panitia` | Updates division settings or active visibility. |
| `DELETE` | `/api/admin/tournaments/:id` | `admin` | Deletes a tournament division and cascades teams/matches. |
| `POST` | `/api/admin/tournaments/:id/init-draw` | `admin`, `panitia` | Initializes a symmetric `4`, `8`, or `16`-slot Technical Meeting draw bracket (`{ "slotCount": 16 }`). |
| `POST` | `/api/admin/tournaments/:id/generate-bracket` | `admin`, `panitia` | Generates a seeded knockout bracket from registered teams (`{ "shuffle": false }`). |
| `POST` | `/api/admin/tournaments/:id/generate-pools` | `admin`, `panitia` | Generates Round-Robin Pool fixtures (`Pool A..H`) plus Stage II Knockout bracket placeholders (`{ "poolCount": 4, "advancePerPool": 2, "shuffle": false }`). |
| `POST` | `/api/admin/tournaments/:id/advance-pools` | `admin`, `panitia` | Evaluates FIVB `3-2-1-0` Pool Standings and advances top qualifiers into Stage II Knockout slots. |
| `POST` | `/api/admin/teams` | `admin`, `panitia` | Registers a team (`name`, `shortCode`, `school`, `color`, plus optional `poolName`, `coachName`, `managerName`, `jerseyColors`). |
| `PATCH` | `/api/admin/teams/:id` | `admin`, `panitia` | Updates team identity, optional Pool code, staff metadata, or jersey colors. |
| `POST` | `/api/admin/teams/:id/logo` | `admin`, `panitia` | Uploads a verified `PNG`/`JPG`/`WEBP` team crest. |
| `DELETE` | `/api/admin/teams/:id` | `admin`, `panitia` | Removes a team. |
| `PATCH` | `/api/admin/matches/:id` | `admin`, `panitia` | Updates match `courtName`, `scheduledAt`, and `stageLabel` metadata. |
| `POST` | `/api/admin/matches/:id/score` | `admin`, `panitia` | Unified live match state-machine action endpoint (`action`: `'start' \| 'point' \| 'timeout' \| 'sub' \| 'serve' \| 'confirm_set_next' \| 'confirm_match_finish' \| 'undo' \| 'extra_set' \| 'finish' \| 'reset'`). |

---

## 4. Broadcast Gallery Media (`/api/media`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/media/reports` | `admin`, `panitia`, `media` | `multipart/form-data` upload accepting `file` (cover poster `PNG`/`JPG`/`WEBP` <= `10MB`), optional `slides` (`1–3` extra photos), optional `video` (`MP4`/`WEBM`/`MOV` <= `45MB`), `matchId`, `caption`, and `scoreSnapshot`. |
| `DELETE` | `/api/media/reports/:id` | `admin`, `panitia`, `media` | Deletes the gallery record and purges all associated cover, slide, and video objects from S3 or local disk. |

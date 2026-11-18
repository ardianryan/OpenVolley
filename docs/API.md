# HTTP REST & SSE API Reference

All API endpoints are served under `/api/*` and return UTF-8 JSON (except SSE streams and `304 Not Modified` responses). Unknown `/api/*` paths return `404` JSON.

---

## 1. Public Spectator & Arena TV Endpoints (`/api/public`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/public/health` | Public | Liveness & telemetry check (`ok`, `sseClients`, `maxSseClients`, `overviewVersion`). Always remains `200` even when `MAINTENANCE_MODE=true`. |
| `GET` | `/api/public/overview` | Public | Complete public state (`settings`, `masterTeams`, `masterCourts`, `tvScreens`, `tournaments`, `teams`, `matches`, `reports`). Supports `ETag` / `If-None-Match` (`304 Not Modified`). Note: `tvPin` is stripped from public responses. |
| `GET` | `/api/public/og-image.png` | Public | Auto-generated `1200×630` PNG social share card rendered from active `siteSettings` and bundled fonts via `@resvg/resvg-wasm` (supports `ETag` `304`). |
| `GET` | `/api/public/asset-proxy` | Public | SSRF-guarded same-origin CORS proxy (`?url=...`) restricted strictly to configured S3 buckets, persisted logos/sponsors/banners, and official audio tracks so Canvas `captureStream()` / `toBlob()` stays origin-clean. |
| `GET` | `/api/public/matches/:id` | Public | Detailed match state with per-set scores and associated `match_reports`. |
| `GET` | `/api/public/tv-screens/:slug` | Public | Returns a configured Arena TV profile (`mode`, `courtId`, `targetMatchId`, standby banner metadata) by slug. |
| `GET` | `/api/public/stream` | Public | Public Server-Sent Events stream (`connected`, `match_updated`, `bracket_updated`, `draw_slot_updated`, `tv_screen_updated`, `courts_updated`, `master_teams_updated`, `report_added`, `report_deleted`). Returns `fallback` if `MAX_SSE_CLIENTS` is reached so clients switch to ETag polling. |
| `GET` | `/api/public/tv-check` | Public | Checks whether the caller holds a valid `ov_tv_vip` or `admin`/`panitia` session cookie, plus `publicTvEnabled` flag. |
| `POST` | `/api/public/tv-auth` | Rate-Limited | Verifies `{ "pin": "4426" }` using constant-time comparison and sets the `HttpOnly` `ov_tv_vip` cookie. |
| `GET` | `/api/public/tv-stream` | TV VIP / Staff | Priority SSE stream reserved for authenticated Arena TV displays. |

---

## 2. Authentication, Roles & User Management (`/api/auth`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Rate-Limited | Authenticates `{ "username", "password" }` and sets the `HttpOnly` `ov_token` JWT cookie (`7-day` TTL). Returns `429` + `Retry-After` after `8` failed attempts in `5` minutes. |
| `POST` | `/api/auth/logout` | Public | Clears the `ov_token` cookie. |
| `GET` | `/api/auth/me` | Live DB Auth | Validates session against live SQLite `users` + `roles` (rejecting deleted/revoked accounts with `401`) and returns `{ id, username, name, role, roleName, permissions, customPermissions, hasCustomPermissions }`. |
| `POST` | `/api/auth/change-password` | Live DB Auth + Rate-Limited | Self-service password update (`{ "currentPassword", "newPassword" }`, min. 6 chars) for any logged-in user. |
| `GET` | `/api/auth/roles` | `users` | Lists system roles (`admin`, `panitia`, `media`) and custom roles with their default menu `permissions` and `isSystem` flag. |
| `POST` | `/api/auth/roles` | `users` | Creates a custom role (`{ name, slug?, description?, permissions }`). |
| `PUT` | `/api/auth/roles/:slug` | `users` | Updates custom role metadata/permissions (for system roles, allows updating default `panitia`/`media` permissions while protecting `admin` full access). |
| `DELETE` | `/api/auth/roles/:slug` | `users` | Deletes an unused custom role (blocks system roles and roles currently assigned to users). |
| `GET` | `/api/auth/users` | `users` | Lists all registered staff accounts (without password hashes), including effective `permissions`, `customPermissions`, and `hasCustomPermissions`. |
| `POST` | `/api/auth/users` | `users` | Creates a staff account bound to any valid `role` slug plus optional per-user `permissions` menu override (`null` inherits role defaults). |
| `PUT` | `/api/auth/users/:id` | `users` | Updates account `name`, `role`, per-user `permissions` override, or resets `password` (blocks self-demotion of the active admin). |
| `DELETE` | `/api/auth/users/:id` | `users` | Deletes a staff account (prevents self-deletion and immediately invalidates active sessions on next request). |

---

## 3. Tournament, Bracket, Scoring & Branding (`/api/admin`)

Every route enforces `requireAuth` (live SQLite session verification) paired with granular `requirePermission(...)` menu guards (`overview`, `contingents`, `schedule`, `tournaments`, `operator`, `tv_screens`, `documents`, `branding`, `users`, `media`, `settings`, `guide`).

| Method | Path | Required Permission | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/overview` | `overview`, `contingents`, `schedule`, `tournaments`, `operator`, `tv_screens`, `documents`, or `branding` | Full operational tournament state; `tvPin` is automatically redacted unless the caller holds `branding` or `tv_screens`. |
| `PUT` | `/api/admin/tv-pin` | `branding` or `tv_screens` | Updates the Arena VIP TV PIN code. |
| `PUT` | `/api/admin/settings` | `branding` | Updates event name, subtitle, metadata, `seoDescription`, `publicDocsEnabled`, `publicTvEnabled`, `docSettingsJson`, accent color, and logo/social resets. |
| `PUT` | `/api/admin/settings/docs` | `documents` or `branding` | Updates official Bulletin & Match Summary metadata (`docSettings`); toggling `publicDocsEnabled` also requires `branding`. |
| `POST` | `/api/admin/settings/doc-cover` | `documents` or `branding` | Uploads a custom A4 Bulletin cover image (`multipart/form-data`). |
| `POST` | `/api/admin/settings/logo` | `branding` | Uploads brand/social images (`main`, `coBrand`, `organizer`, `social`, `docCover`) via `multipart/form-data`. |
| `POST` | `/api/admin/settings/sponsors` | `branding` | Uploads a sponsor or media partner (supports light/dark logos and `boxed` plate flag). |
| `PUT` | `/api/admin/settings/sponsors/reorder` | `branding` | Reorders sponsor priority (first 3 entries render as Top-3 Principal tier). |
| `DELETE` | `/api/admin/settings/sponsors/:id` | `branding` | Deletes a sponsor entry. |
| `POST` | `/api/admin/tournaments` | `tournaments` | Creates a tournament division (`bestOf`, `regularSetPoints`, `decidingSetPoints`, `useDeuce`, `hasThirdPlace`). |
| `PUT` | `/api/admin/tournaments/:id` | `tournaments` | Updates division settings or active visibility. |
| `DELETE` | `/api/admin/tournaments/:id` | `tournaments` | Deletes a tournament division and cascades teams/matches. |
| `POST` | `/api/admin/tournaments/:id/init-draw` | `tournaments` | Initializes a symmetric `4`, `8`, `16`, or `32`-slot Technical Meeting draw bracket (`{ "slotCount": 16 }`). |
| `PUT` | `/api/admin/tournaments/:id/draw-slot` | `tournaments` | Assigns (with duplicate guard / optional `squadLabel`) or clears a Master Contingent inside a TM Draw Slot and broadcasts `draw_slot_updated` + `bracket_updated` SSE events. |
| `POST` | `/api/admin/tournaments/:id/entries-from-master` | `tournaments` | Batch-enrolls multiple Master Contingents into a category prior to seeded/smart draw. |
| `POST` | `/api/admin/tournaments/:id/generate-bracket` | `tournaments` | Generates a seeded knockout bracket from registered teams (`{ "shuffle": false, "separateSameRegion": true }`). |
| `POST` | `/api/admin/tournaments/:id/generate-pools` | `tournaments` | Generates Round-Robin Pool fixtures (`Pool A..H`) with FIVB Snake Seeding + region separation (`{ "poolCount": 4, "advancePerPool": 2, "shuffle": false, "separateSameRegion": true }`). |
| `POST` | `/api/admin/tournaments/:id/advance-pools` | `tournaments` | Evaluates FIVB `3-2-1-0` Pool Standings and advances top qualifiers into Stage II Knockout slots. |
| `POST` | `/api/admin/master-teams` | `contingents` or `tournaments` | Registers a single shared club/school/region in `master_teams`. |
| `POST` | `/api/admin/master-teams/bulk` | `contingents` or `tournaments` | Bulk-imports Tab-separated (Google Sheets/Excel) or Pipe-separated rows into `master_teams`. |
| `PATCH` | `/api/admin/master-teams/:id` | `contingents` or `tournaments` | Updates a Master Contingent and propagates identity/non-overridden defaults to all linked division teams. |
| `POST` | `/api/admin/master-teams/:id/logo` | `contingents` or `tournaments` | Uploads and syncs a shared Master Contingent crest across all linked divisions. |
| `DELETE` | `/api/admin/master-teams/:id` | `contingents` or `tournaments` | Deletes a Master Contingent (preserving category team records safely). |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/admin/master-courts` (`/:id`) | `schedule` or `tournaments` | Lists, creates, renames (with cascading `matches.courtName` sync), or deletes centralized courts. |
| `POST` | `/api/admin/matches/bulk-schedule-assign` | `schedule` or `tournaments` | Batch-moves matches between courts or applies time-slot patterns across courts. |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/admin/tv-screens` (`/:id`) | `tv_screens` | Manages Arena TV screen profiles and remotely pushes mode/target/standby-banner updates via `tv_screen_updated` SSE. |
| `POST` | `/api/admin/tv-screens/:id/banner` | `tv_screens` | Uploads an optional custom fullscreen standby backdrop image for a TV profile. |
| `POST` | `/api/admin/teams` | `tournaments` | Registers a team (`name`, `shortCode`, `school`, `color`, plus optional `poolName`, `coachName`, `managerName`, `jerseyColors`). |
| `PATCH` | `/api/admin/teams/:id` | `tournaments` | Updates team identity, optional Pool code, staff metadata, or jersey colors. |
| `POST` | `/api/admin/teams/:id/logo` | `tournaments` | Uploads a verified `PNG`/`JPG`/`WEBP` team crest. |
| `DELETE` | `/api/admin/teams/:id` | `tournaments` | Removes a team. |
| `PATCH` | `/api/admin/matches/:id` | `schedule`, `tournaments`, or `operator` | Updates match `courtName`, `scheduledAt`, and `stageLabel` metadata. |
| `POST` | `/api/admin/matches/:id/score` | `operator` | Unified live match state-machine action endpoint (`action`: `'start' \| 'point' \| 'timeout' \| 'sub' \| 'serve' \| 'confirm_set_next' \| 'confirm_match_finish' \| 'undo' \| 'extra_set' \| 'finish' \| 'reset'`). |

---

## 4. Broadcast Gallery Media (`/api/media`)

| Method | Path | Required Permission | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/media/reports` | `media` or `operator` | `multipart/form-data` upload accepting `file` (cover poster `PNG`/`JPG`/`WEBP` <= `10MB`), optional `slides` (`1–3` extra photos), optional `video` (`MP4`/`WEBM`/`MOV` <= `45MB`), `matchId`, `caption`, and `scoreSnapshot`. |
| `DELETE` | `/api/media/reports/:id` | `media` or `operator` | Deletes the gallery record and purges all associated cover, slide, and video objects from S3 or local disk. |

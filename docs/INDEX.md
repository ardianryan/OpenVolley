# OpenVolley Documentation

Welcome to the official technical documentation for **OpenVolley (`v0.1.0`)**.

---

## Core Guides

1. **[Architecture & Internals (`ARCHITECTURE.md`)](ARCHITECTURE.md)**
   - Single-process Bun + Hono runtime, SQLite WAL persistence, adaptive SSE/ETag delivery, symmetric bracket engine, and the client-side Canvas/WebGL/WebAudio Broadcast Media Studio.
2. **[REST & SSE API Reference (`API.md`)](API.md)**
   - Complete request/response specification for `/api/public/*`, `/api/auth/*`, `/api/admin/*`, and `/api/media/*`, including authentication cookies, rate-limiting headers, and SSE event payloads.
3. **[Production Deployment Guide (`DEPLOYMENT.md`)](DEPLOYMENT.md)**
   - Deploying with Docker Compose or GitHub Container Registry (`ghcr.io/ardianryan/openvolley`), Nginx + Cloudflare Orange Cloud reverse proxying, S3 object storage setup, `MAINTENANCE_MODE`, and zero-downtime SQLite backups.
4. **[Testing & Verification Guide (`TESTING.md`)](TESTING.md)**
   - Running unit, feature, E2E security, WCAG 2.1 AA contrast audits, and ephemeral Docker container verification.
5. **[Citation & Academic Reference (`CITATION.md`)](CITATION.md)**
   - Official BibTeX, APA, IEEE, and `CITATION.cff` references.

---

## Repository Governance

- **[`README.md`](../README.md)** — Project overview and quickstart.
- **[`CHANGELOG.md`](../CHANGELOG.md)** — Release history (`v0.1.0`).
- **[`TODO.md`](../TODO.md)** — Completed milestones and `v0.2.0`–`v1.0.0` roadmap.
- **[`SECURITY.md`](../SECURITY.md)** — Coordinated vulnerability disclosure and built-in security controls.
- **[`CONTRIBUTING.md`](../CONTRIBUTING.md)** — Contribution workflow and engineering standards.
- **[`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md)** — Contributor Covenant v2.1.
- **[`.github/CUSTOM_PROPERTIES.md`](../.github/CUSTOM_PROPERTIES.md)** — GitHub Custom Properties & repository metadata manifest.
- **[`LICENSE`](../LICENSE) & [`NOTICE`](../NOTICE)** — Apache License 2.0 + Commons Clause v1.0.

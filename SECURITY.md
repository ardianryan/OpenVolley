# Security Policy

## Supported Versions

Only the latest minor release line receives active security patches and dependency updates.

| Version | Supported |
| :--- | :--- |
| `0.1.x` | Yes |
| `< 0.1.0` | No |

---

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Instead, report suspected vulnerabilities privately using one of the following channels:

1. **GitHub Private Vulnerability Reporting (Preferred):**
   Navigate to the [**Security → Advisories → Report a vulnerability**](https://github.com/ardianryan/OpenVolley/security/advisories/new) tab on the repository.
2. **Direct Maintainer Contact:**
   Reach out privately via [@ardianryan on GitHub](https://github.com/ardianryan) with `[SECURITY] OpenVolley` in the subject line.

### What to Include
- Affected version or commit SHA (`v0.1.0`, `main`, etc.).
- Step-by-step reproduction instructions or minimal proof-of-concept request/payload.
- Expected impact (e.g., authentication bypass, stored XSS, privilege escalation, DoS).

### Response Timeline
- **Initial acknowledgment:** within **72 hours**.
- **Triage & remediation plan:** within **7 business days**.
- **Coordinated disclosure:** credit is awarded in the release notes and GitHub Security Advisory once a patch is published (unless anonymity is requested).

---

## Built-In Security Controls

OpenVolley implements defense-in-depth protections out of the box:

1. **Strict Content-Security-Policy (Zero `'unsafe-inline'` Scripts)**
   - Enforced globally by [`src/server/middleware/security.ts`](src/server/middleware/security.ts): `script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`.
   - Pre-paint theme initialization runs from an external static script (`/theme-init.js`) so inline scripts remain completely disabled.
2. **Multi-Layer Anti-XSS Sanitization**
   - [`src/shared/sanitize.ts`](src/shared/sanitize.ts) strips `<script>` blocks, inline event handlers, control bytes, CSS style-breakout strings, `javascript:` / `vbscript:` / `data:text/html` URLs, and path traversal sequences on both server write paths and client render components.
3. **Cryptographic Magic-Byte Upload Verification & Upload Sandboxing**
   - [`src/server/services/upload.ts`](src/server/services/upload.ts) inspects raw binary file signatures (`PNG`, `JPEG`, `WEBP`, `MP4`/`MOV` ISO-BMFF `ftyp`, `WebM` EBML) rather than trusting client `Content-Type` headers or file extensions, blocking spoofed SVG/HTML polyglots.
   - Local fallback uploads under `/uploads/*` are served with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox`.
4. **Authentication, Constant-Time Secrets & RBAC**
   - Passwords are hashed using `Bun.password.hash` (Argon2id).
   - Session tokens (`ov_token`) and Arena TV VIP tokens (`ov_tv_vip`) use `HS256` JWTs stored in `HttpOnly`, `SameSite=Lax` cookies with automatic `Secure` flag upgrades behind HTTPS / reverse proxies.
   - Arena TV PIN comparisons use SHA-256 + `crypto.timingSafeEqual` (`safeComparePin`) to eliminate timing side channels.
   - Role checks (`admin`, `panitia`, `media`) are enforced independently on every server mutation route and Back-Office view.
5. **Brute-Force Rate Limiting & SSE Connection Caps**
   - Sliding-window per-IP rate limiters protect `/api/auth/login` and `/api/public/tv-auth` (`429 Too Many Requests` + `Retry-After`).
   - Public SSE connections are bounded (`MAX_SSE_CLIENTS`) while preserving dedicated capacity for authenticated Arena TV displays.
6. **Automated Static Analysis & Dependency Auditing**
   - GitHub **CodeQL** (`security-extended` + `security-and-quality`) runs on every push, pull request, and weekly schedule alongside **Dependabot** updates.

---

## Production Hardening Checklist

Before running OpenVolley in a live tournament environment:

- [ ] Set a cryptographically random `JWT_SECRET` (`openssl rand -hex 32`) in `.env`.
- [ ] Change default seeded passwords (`admin`, `panitia`, `media`) and rotate the default Arena TV PIN (`4426`).
- [ ] Terminate TLS (`HTTPS`) in front of OpenVolley via Cloudflare Tunnel, Nginx, or Caddy so session cookies automatically receive the `Secure` attribute.
- [ ] Keep `.env` and `./data/` outside public web roots and back up `./data/openvolley.db` regularly.

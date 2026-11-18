# Contributing to OpenVolley

Thank you for your interest in contributing to **OpenVolley**! Community bug fixes, performance improvements, accessibility refinements, documentation enhancements, and new tournament features are warmly welcomed.

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md) and the contribution terms in [`LICENSE`](LICENSE) (Apache-2.0 + Commons Clause v1.0).

---

## Language Convention

- **Codebase, Comments, Docs, Issues, PRs & Commit Messages:** Write in clear **English**.
- **User-Facing UI Copy:** Keep default court/spectator interface strings in natural, concise **Indonesian** (*Bahasa Indonesia*) unless working on internationalization support.

---

## Local Development Setup

### Prerequisites
- [Bun](https://bun.sh) `>= 1.2`
- Node-compatible TypeScript toolchain (bundled via `bun install`)
- Optional: Docker Engine / Docker Compose for container testing

### Getting Started

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/OpenVolley.git
cd OpenVolley

# 2. Install exact locked dependencies
bun install --frozen-lockfile

# 3. Copy sample environment variables
cp .env.example .env

# 4. Start backend watch server (:3000) + Vite HMR client (:5173)
bun run dev
```

- Frontend HMR server: `http://localhost:5173` (proxies `/api` and `/uploads` to `:3000`)
- Direct production server preview: `bun run build && bun start` (`http://localhost:3000`)

---

## Branching & Commit Guidelines

1. Branch from `main` using descriptive prefixes:
   - `feat/<topic>` — new user-facing or API capability
   - `fix/<topic>` — bug fix or regression patch
   - `sec/<topic>` — non-sensitive security hardening
   - `docs/<topic>` — documentation or diagram updates
   - `test/<topic>` — unit, feature, or E2E test coverage
   - `chore/<topic>` — build, CI, or dependency maintenance
2. Use **[Conventional Commits](https://www.conventionalcommits.org/)**:
   - `feat(studio): add multi-slide gallery carousel and lightbox`
   - `fix(scoring): enforce two-point lead during deciding set deuce`
   - `ci(docker): add multi-arch GHCR release workflow`

---

## Engineering & UI Quality Standards

1. **Zero Unsafe DOM Sinks & Strict CSP**
   - Never introduce inline `<script>` tags, `eval()`, `dangerouslySetInnerHTML` with untrusted strings, or unvalidated asset URLs.
   - Always sanitize user-supplied text and URLs through [`src/shared/sanitize.ts`](src/shared/sanitize.ts).
2. **UI Craft & Accessibility (WCAG 2.1 AA)**
   - **No emoji icons in UI components** — use crisp SVG icons from `lucide-react` or custom geometric SVGs.
   - Maintain at least **4.5:1** text contrast in both Light and Dark themes (`#0B0F19` obsidian / `#F8FAFC` light surfaces).
   - Ensure interactive controls on mobile have a minimum `44×44px` (`min-h-11 min-w-11`) touch target and visible `:focus-visible` outlines.
   - Respect `@media (prefers-reduced-motion: reduce)`.
3. **Bundle Discipline**
   - Keep heavy optional libraries (such as `@ffmpeg/ffmpeg` or `heic2any`) dynamically imported so the spectator portal initial bundle stays fast on cellular stadium networks.

---

## Required Verification Before Submitting a PR

Every pull request must pass all four checks locally and in GitHub Actions:

```bash
bun run typecheck      # 0 TypeScript errors
bun run test:unit      # Unit test suite
bun run test:feature   # Feature & RBAC lifecycle suite
bun run test:e2e       # End-to-end & security hardening suite
bun run build          # Production Vite client build
```

---

## Pull Request Checklist

- [ ] Code compiles cleanly with `bun run typecheck` and `bun run build`.
- [ ] New behavior or bug fixes include corresponding tests (`test:unit`, `test:feature`, or `test:e2e`).
- [ ] Both Light Mode, Dark Mode, and System Theme transitions render cleanly with WCAG AA contrast.
- [ ] No secrets, `.env` files, or local SQLite databases (`*.db*`) are included in the diff.
- [ ] Documentation (`README.md`, `docs/*`, `CHANGELOG.md` under `[Unreleased]`) is updated if public behavior or configuration changed.

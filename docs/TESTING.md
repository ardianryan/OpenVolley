# Testing & Verification Guide

OpenVolley maintains a layered automated test suite executed via Bun's native test runner (`bun:test`) in under 2 seconds using isolated in-memory SQLite instances (`NODE_ENV=test` → `:memory:`), ensuring local tournament data in `./data/openvolley.db` is never touched by tests.

---

## 1. Test Layers

| Command | Scope | Files Covered |
| :--- | :--- | :--- |
| `bun run typecheck` | Strict TypeScript static verification across client, server, and shared modules. | `tsconfig.json` |
| `bun run test:unit` | Pure algorithmic & domain unit tests: bracket seeding/draw math, rally/deuce/undo engine, anti-XSS sanitizers, SPA route registry, iPhone `.HEIC`/`.MOV` magic-byte detection, adaptive video timeline math, S3 audio selector, 3-state theme cycle, and multi-slide gallery parser. | `src/shared/*.test.ts`, `src/server/services/*.test.ts` |
| `bun run test:feature` | Multi-step feature workflows: 3-role RBAC enforcement (`admin` vs `panitia` vs `media`), 8-team bracket lifecycle with deuce rally confirmation, and conditional `ETag` (`304`) caching. | `src/server/features.test.ts` |
| `bun run test:e2e` | Full HTTP & security integration suite: 16-team Technical Meeting draw, live rally auto-advancement to Finals & 3rd Place, spoofed SVG/HTML/fake-MP4 upload rejection, strict zero-`unsafe-inline` CSP headers, Cloudflare Real-IP extraction, TV PIN rate limiting (`429`), `MAINTENANCE_MODE` (`503`), and multi-slide + video gallery lifecycle. | `src/server/e2e.test.ts` |
| `bun test` | Runs every test file in a single pass (`42+` tests). | `**/*.test.ts` |

---

## 2. Ephemeral Remote/Local Docker Verification

To verify the production container image on a staging Docker daemon (such as an SSH Docker host) without leaving leftover containers or images on disk:

```bash
# Build, smoke-test, and immediately clean up container + image on a remote SSH Docker host
tar --exclude='node_modules' --exclude='dist' --exclude='data' --exclude='.git' --exclude='.env' -czf - . \
  | ssh staginglocaldocker '
      set -euo pipefail
      TMP_DIR=$(mktemp -d)
      cleanup() {
        docker rm -f ov-ephemeral-test >/dev/null 2>&1 || true
        docker rmi -f openvolley:ephemeral-test >/dev/null 2>&1 || true
        rm -rf "$TMP_DIR"
      }
      trap cleanup EXIT
      tar -xzf - -C "$TMP_DIR"
      docker build -t openvolley:ephemeral-test "$TMP_DIR"
      docker run -d --name ov-ephemeral-test -p 127.0.0.1:13099:3000 \
        -e JWT_SECRET="ephemeral-smoke-secret-minimum-32-chars" \
        openvolley:ephemeral-test
      for i in $(seq 1 20); do
        curl -fsS http://127.0.0.1:13099/api/public/health && break
        sleep 1
      done
    '
```

Because `trap cleanup EXIT` executes unconditionally (whether the test succeeds or fails), both `ov-ephemeral-test` and `openvolley:ephemeral-test` are immediately removed after verification.

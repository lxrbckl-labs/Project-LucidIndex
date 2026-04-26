# `@lucidindex/e2e`

End-to-end Playwright suite for LucidIndex. Lives in its own workspace so Playwright never bleeds into the `apps/web` Docker image.

## What it covers (today)

- **Phase 1 acceptance — founding-admin smoke** (`e2e/founding-admin.spec.ts`)
  - Public landing renders the wordmark + empty state.
  - Founding-admin claim via virtual WebAuthn authenticator.
  - One-time recovery-code modal renders.
  - After the claim, `/settings` is gated to `/settings/login` (not `/settings/found`).

Later phases will add their own specs in `e2e/`.

## How to run

Pre-reqs:

- Docker daemon running (the suite boots a throw-away Postgres 16 container on `127.0.0.1:5440`).
- `pnpm install` at the repo root has completed at least once. The workspace's `postinstall` script downloads Playwright's Chromium binary.

From the repo root:

```sh
pnpm test:e2e
```

Or from `tests/`:

```sh
pnpm test:e2e
```

To watch the browser:

```sh
PLAYWRIGHT_HEADED=1 pnpm test:e2e
```

## What the suite does to your machine

- Boots a Postgres 16 container named `lucidindex-e2e-postgres` on `127.0.0.1:5440`. Removed on teardown (and force-removed at boot if a stale one exists).
- Spawns `next dev` on `127.0.0.1:3401` with throw-away env vars (founding token, iron-session secret, RP config). Killed on teardown.
- Runs `pnpm db:migrate` against the throw-away DB to apply Phase 1 migrations.

Both port numbers can be overridden with `LUCIDINDEX_E2E_PG_PORT` and `LUCIDINDEX_E2E_WEB_PORT` env vars.

## What it does NOT do (yet)

The suite runs against `next dev` for speed. Phase 8's deploy ticket will add a separate true-stack smoke that brings up the production `docker compose` services (`docker compose up -d --build`) and runs against the built image. That smoke verifies the production wiring; this one verifies the application logic.

## Notes on the dev-server harness

- The harness pre-compiles the founding + login API routes before the test starts. In `next dev`, route handler bundles are built lazily on first request, and the `lib/challenge-store.ts` module-level `Map` (the in-memory WebAuthn challenge store) is reset when a route bundle is first compiled — so a `/start` -> `/finish` ceremony where `/finish` is being compiled for the first time loses the challenge mid-flight. Pre-warming both routes side-steps this. Production (`next start`) doesn't have this issue.
- Both ports (`5440` for Postgres, `3401` for the web server) are bound to `127.0.0.1` only. The test browser navigates to `http://localhost:3401` so that the WebAuthn RP ID (`localhost`) matches the page hostname — `localhost` is not a registrable suffix of `127.0.0.1` and Chromium would reject the ceremony otherwise.

## Why a separate workspace

Playwright is a heavyweight integration tool, not an `apps/web` build dep. Keeping it in `tests/` means the production Docker image stays small, type-checks of the app don't pull in Playwright's globals, and we mirror the same shape Project-DS uses for its `tests/` tree.

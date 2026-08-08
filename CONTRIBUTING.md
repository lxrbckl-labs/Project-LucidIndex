# Contributing to LucidIndex

Opinionated short-form guide. Read this once before touching code.

---

## Quick start

```sh
git clone https://github.com/lxrbckl-labs/Project-LucidIndex.git
cd Project-LucidIndex
pnpm install          # installs + auto-builds packages (templates, db, shared)
pnpm test:e2e         # smoke-test the full stack — all 29 specs should pass
```

`pnpm install` runs `prepare` via Lefthook, which builds `@lucidindex/templates`,
`@lucidindex/db`, and `@lucidindex/shared`. You do **not** need to run a separate
build step before starting the dev server.

---

## Workspace layout

```
apps/
  web/          Next.js 15 app (dashboard, article pages, settings, auth, SSE)
  cron/         node-cron sidecar — 7 scheduled jobs
  mcp-dashboard/    MCP server sidecar — 5 agent tools over Streamable HTTP + stdio
packages/
  db/           Drizzle schema, migrations, seed, Postgres client
  auth/         WebAuthn + iron-session (ported from Project-Showalter)
  templates/    LiquidJS prompt-template helpers + 7 starter templates
  shared/       Slug generation; cross-package types
tests/
  e2e/          Playwright end-to-end specs (29 specs at time of writing)
```

---

## Local dev loop

### Spin up Postgres

Pick one:

```sh
# Option A — Docker Compose (recommended, matches prod exactly)
docker compose up -d postgres

# Option B — Homebrew (macOS)
brew install postgresql@16
brew services start postgresql@16
createdb lucidindex
```

Copy and configure `.env`:

```sh
cp apps/web/.env.example .env
# Minimum for local dev: DATABASE_URL is already set to localhost:5432/lucidindex.
# Set IRON_SESSION_PASSWORD to any 32+ char string.
```

Apply migrations and seed:

```sh
pnpm db:migrate   # runs drizzle-kit migrate against DATABASE_URL
pnpm db:seed      # idempotent — safe to run multiple times
```

### Start the web app

```sh
pnpm --filter @lucidindex/web dev
# or shorthand from the root:
pnpm dev
```

The app is at `http://localhost:47892`. To claim founding-admin, visit
`http://localhost:47892/settings` and click **Generate token** (no env-var token —
it's the on-page flow; first claim wins). Save the `lipc_…` passcode it shows,
then enroll a passkey.

### Run with mocks (no Postgres needed)

```sh
LUCIDINDEX_MOCK=1 pnpm dev
```

Mock mode bypasses the session gate and renders the dashboard with fixture
articles. Useful for UI work when you don't want to spin up a database.

---

## Testing

### Playwright E2E (full stack, required for PR)

```sh
pnpm test:e2e
```

Playwright starts its own stack (Postgres + web + mcp-dashboard) via a test
fixture. Make sure nothing is already occupying port 47892 or 4000.

### Vitest unit tests

```sh
pnpm --filter @lucidindex/auth test    # WebAuthn helpers, session logic
pnpm --filter @lucidindex/shared test  # Slug generation
```

---

## Adding a Drizzle migration

1. Edit the relevant schema file in `packages/db/schema/*.ts`.
2. Run `pnpm db:generate` — Drizzle Kit inspects the schema diff and writes
   a new SQL file under `packages/db/migrations/`.
3. Commit **both** the schema change and the generated SQL file. Never hand-edit
   the migration SQL or the `meta/_journal.json`.
4. The web container runs `drizzle-kit migrate` on every startup — production
   picks up the new file automatically on the next deploy.

---

## Style

- **Lint + format:** [Biome](https://biomejs.dev/). Run `pnpm lint` to check,
  `pnpm format` to auto-fix. Lefthook runs `biome check --write` on staged
  files at pre-commit — you shouldn't need to run it manually.
- **TypeScript:** `tsconfig.base.json` sets `strict: true`. The root
  `pnpm typecheck` type-checks every package and app.
- **Conventional commits** are encouraged but not enforced by tooling:
  `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.

---

## PR workflow

- Every change ships through a PR — no direct pushes to `main`.
- **Agent PRs** follow the branch naming convention `feat/swe-N/...` or
  `fix/swe-N/...`. The QA subagent reviews and merges these directly.
- **Human PRs** (any other branch): QA reviews and comments; a human merges.
- Draft PRs signal "not ready" — never auto-merged.
- Delete the branch after merge.

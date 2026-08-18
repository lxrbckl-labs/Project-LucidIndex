# Architecture — as built

> **Living document.** This describes the codebase as it exists today, not
> the design spec. For design rationale, see the vault notes referenced at
> the bottom of this file.

---

## Stack at a glance

| Layer | Tech |
|---|---|
| Web app | **Next.js 15** (App Router, RSC, Server Actions, Route Handlers) + **React 19** |
| Styling | **Tailwind CSS v4** + **shadcn/ui** + Radix primitives + Lucide icons |
| Database | **PostgreSQL 16** via **Drizzle ORM** 0.45 + Drizzle Kit (migrations) + `postgres-js` driver |
| Auth | **Passkeys only** (WebAuthn) via **SimpleWebAuthn** 13 + **iron-session** 8 — ported from Project-Showalter |
| Agent surface | **`@modelcontextprotocol/sdk`** — Streamable HTTP (bearer-token argon2id) + stdio transports |
| Prompt templates | **LiquidJS** — sandboxed, rendered at queue-pull time |
| Image processing | **`sharp`** — resize to max 1600 px wide, EXIF strip, WebP + JPEG dual output |
| Cron | **`node-cron`** in the `cron` sidecar |
| Realtime | **SSE** via Next.js Route Handler (Node runtime) |
| Search | Postgres FTS — `tsvector` generated column + GIN index over title + summary + agent_deep_dive |
| Bearer-token hashing | **argon2id** via `@node-rs/argon2` |
| Logging | **`pino`** (`pino-pretty` in dev, structured JSON in prod) |
| Lint + format | **Biome** |
| Pre-commit | **Lefthook** |
| Testing | **Vitest** (unit) + **Playwright** (E2E) |
| Container | **Docker Compose** — four services |
| Reverse proxy | **Host-resident Caddy** — outside this repo |
| Language | **TypeScript** strict (`tsconfig.base.json`) + Node ≥ 22 |
| Package manager | **pnpm** 10 workspaces |

---

## Topology

```
                       ┌──────── host ──────────────────────────────────────┐
                       │                                                     │
  Internet ──── 443 ──▶│  Caddy (TLS termination, Let's Encrypt)            │
                       │    ├── /mcp/* → 127.0.0.1:4000                     │
                       │    └── /*     → 127.0.0.1:47892                     │
                       │                                                     │
                       │  ┌──── docker-compose stack ──────────────────┐    │
                       │  │                                             │    │
                       │  │  web          127.0.0.1:47892:47892        │    │
                       │  │  mcp-dashboard    127.0.0.1:4000:4000          │    │
                       │  │  cron         (no HTTP surface)            │    │
                       │  │  postgres     127.0.0.1:5432:5432          │    │
                       │  │                                             │    │
                       │  └─────────────────────────────────────────────┘   │
                       └─────────────────────────────────────────────────────┘

  Agent (Claude Code / any MCP client)
    └── HTTPS POST /mcp/*  →  Caddy  →  mcp-dashboard:4000 (bearer-token auth)
```

Caddy is **not shipped** in this repo. It is the existing homelab reverse proxy,
configured with a site block as described in [`docs/deploy.md`](deploy.md).

Ports are bound to `127.0.0.1` — no service is exposed directly on the public
interface; all traffic reaches them via Caddy.

---

## Service responsibilities

### `apps/web`

Next.js 15 App Router application. The human-facing half of the product.

- **Dashboard** (`/`) — Fyrre-Magazine masonry grid of article tiles, topic-badge filter row,
  live article stream via SSE (`/api/events`). Authenticated admin gets star/hide/read controls.
- **Article page** (`/a/[slug]`) — full article with agent deep-dive, cross-source list, share
  link, star/hide buttons. Loaded by `app/a/[slug]/loader.ts`.
- **Creator page** (`/c/[slug]`) — aggregated view per target (creator). Slug is generated lazily
  via `getOrSetTargetSlug()` on first visit and persisted; `app/c/[slug]/loader.ts` owns this.
- **Search** (`/search`) — full-text search over `tsvector` generated column.
- **Image route** (`/i/[hash]`) — serves hero images from disk. Content-negotiates WebP vs JPEG
  from the `Accept` header. Reads from `MCP_IMAGE_DIR` (shared volume with `mcp-dashboard`).
- **Settings** — passkey-gated admin UI at `/settings/*`:
  - `account` — passkey management, recovery code regeneration
  - `agent-tokens` — create / revoke tokens; byline labels
  - `badges` — curate topic badges; approve/reject `topic_badge_suggestions`
  - `targets` — watch-queue management (add, pause, edit cadence)
  - `templates` — edit LiquidJS prompt templates
  - `off-site-backup` — configure rclone remote + credentials
  - `hidden-articles` — restore hidden articles
  - `system` — cron job health (last tick per job), SSE test, standing prompt copy
- **Auth API** (`/api/auth/*`) — founding-admin claim, passkey register/authenticate, logout,
  session probe. Thin wrappers over `@lucidindex/auth`.
- **SSE** (`/api/events`) — `text/event-stream`, `event: article:new` payloads. Authenticated
  admin only. 25-second `: ping` heartbeat. In-process bus via `lib/sse/article-bus.ts`
  (cross-process SSE from `mcp-dashboard` is a future ticket, likely Postgres LISTEN/NOTIFY).
- **Auto-migrate on startup** — `entrypoint.sh` runs `drizzle-kit migrate` then `seed.ts` before
  binding port 47892. The `web` service's Docker healthcheck therefore doubles as a "schema is ready"
  signal; `mcp-dashboard` and `cron` use `depends_on: web: condition: service_healthy` so they never
  query an un-migrated DB.
- **Mock mode** — `LUCIDINDEX_MOCK=1` bypasses the session gate and renders fixture articles from
  `app/_mock/articles.ts`. Used for UI development without a live Postgres.

### `apps/cron`

Node process running `node-cron`. No HTTP surface — communicates exclusively
via Postgres state. All ticks write to `cron_runs` via the shared `runJob()`
envelope in `src/lib/run-job.ts`.

Seven scheduled jobs:

| Job | Schedule | What it does |
|---|---|---|
| `heartbeat` | every minute | Writes a `cron_runs` row to prove the sidecar is alive and DB-reachable |
| `scheduler` | every minute | Sweeps `targets` for rows where `next_due_at ≤ now()`, inserts `queue` rows, collapses missed ticks |
| `reaper` | every minute | Releases `queue` rows where `acked_at IS NULL AND locked_until < now()` (dead-lock recovery) |
| `hwm_reset` | every minute | Clears `high_water_mark` and resets `hwm_reset_pending` for unpaused targets |
| `retention_purge` | daily 03:00 | Rolls articles off the dashboard at 14 days; hard-deletes (except starred) at 6 months; removes hero image files alongside row deletes |
| `local_backup` | nightly 02:00 | `pg_dump` (custom format) + image-tree tarball into `BACKUP_DIR`; sweeps files older than `BACKUP_RETENTION_DAYS` (default 14) |
| `off_site_backup` | nightly 02:30 | `rclone copy` latest local backup to admin-configured remote; credentials decrypted from `settings.off_site_backup_credentials_encrypted` using `IRON_SESSION_PASSWORD` |

Schedules use `CRON_TIMEZONE` (default UTC) for the nightly jobs.

### `apps/mcp-dashboard`

MCP server. The agent-facing half of the product.

Transports:
- **Streamable HTTP** (default, `MCP_DASHBOARD_TRANSPORT=http`, port 4000) — bearer-token auth via argon2id lookup against `agent_tokens.token_hash`. Per-request stateless: a fresh `McpServer` + `StreamableHTTPServerTransport` is constructed for each incoming request.
- **stdio** (`MCP_DASHBOARD_TRANSPORT=stdio`) — process-local trust; no bearer auth. Used for co-located agents or the MCP inspector in dev.

Five tools, registered in `src/tools/index.ts`:

| Tool | Transport | What it does |
|---|---|---|
| `pull_queue_item` | HTTP + stdio | Atomically claims the next due queue row with `FOR UPDATE SKIP LOCKED`; renders the LiquidJS prompt template with target context; returns rendered prompt + high-water-mark |
| `ack_queue_item` | HTTP only | Marks the queue row as acked; upserts the terminal `run_log` row with pass/fail status |
| `write_articles` | HTTP only | Inserts article rows, deduplicates on `(target_id, source_url)`, routes unknown topic badges to `topic_badge_suggestions`, runs the hero-image pipeline (fetch → sharp resize → WebP + JPEG dual-write) |
| `get_topic_badges` | HTTP + stdio | Returns the curated `topic_badges` list so agents classify consistently |
| `get_high_water_mark` | HTTP + stdio | Returns the current `high_water_mark` for a target without claiming a queue row |

All tools pass through a **pre-admin guard** that returns `no_admin_enrolled` if
no founding admin has been claimed yet.

### `packages/db`

Drizzle schema, generated migrations, Postgres client, and seed.

**Schema tables** (one table per file under `schema/`):

| Table | Purpose |
|---|---|
| `admins` | Single founding admin row |
| `credentials` | WebAuthn credential IDs + public keys (bytea) |
| `recovery_codes` | Hashed one-time recovery codes |
| `auth_events` | Append-only audit log of all auth events |
| `agent_tokens` | Per-agent bearer tokens (argon2id hashes) + byline labels |
| `prompt_templates` | LiquidJS template bodies; 7 starters seeded on first boot |
| `settings` | Singleton settings row (singleton enforced via CHECK `id = 1`) |
| `targets` | Watch queue: creator handles / URLs, cadence, high-water-mark |
| `queue` | Scheduler's working queue — one row per due target tick |
| `run_log` | Append-only log of every agent pass (succeeded or failed) |
| `articles` | All filed articles; `tsvector` generated column for FTS |
| `topic_badges` | Curated badge taxonomy |
| `topic_badge_suggestions` | Inbox of unknown badge names from agents (upsert on repeat) |
| `cron_runs` | Every cron tick audit log |

Migrations are in `packages/db/migrations/` (SQL files + Drizzle Kit `meta/_journal.json`).
The `web` container applies them automatically on startup via `entrypoint.sh`.

### `packages/auth`

WebAuthn + iron-session port from Project-Showalter.

- Founding-admin claim (one-time token-gated passkey registration)
- Passkey register + authenticate (SimpleWebAuthn server-side helpers)
- Recovery code generation, validation, and consumption
- `requireAdmin()` — reads iron-session from the Next.js request; used by settings
  routes and the SSE endpoint

### `packages/templates`

LiquidJS helpers + 7 starter prompt templates (youtube, blog, newsletter, news,
instagram, x, website). Templates are seeded into `prompt_templates` on first
boot; admins can edit them in Settings → Templates. `mcp-dashboard` renders the
relevant template at `pull_queue_item` time with target context variables
(`creator_name`, `target_url`, `high_water_mark`, `cadence`, `cross_source_n`).

### `packages/shared`

Deterministic slug generation (`YYYY-MM-DD-<kebab-title>`) shared between
`write_articles` (where the slug is first created) and the article-page route
handler (so the two stay in sync). Also exports cross-package TypeScript types.

---

## Data flow — single article, end to end

```
1. Admin adds a target in Settings → Targets
   └── PATCH /api/settings/targets → inserts into `targets`

2. cron: scheduler tick (every minute)
   └── runScheduler() sweeps targets where next_due_at ≤ now()
       └── inserts a row into `queue`

3. Agent calls pull_queue_item (HTTP POST /mcp/*, bearer token)
   └── Atomic UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)
   └── Renders LiquidJS template with target context
   └── Returns { queue_item_id, rendered_prompt, high_water_mark, ... }

4. Agent does its work (scrape, summarize, classify) — entirely outside LucidIndex

5. Agent calls write_articles (HTTP POST /mcp/*)
   └── Deduplicates on (target_id, source_url)
   └── Validates topic_badges; unknown badges → topic_badge_suggestions
   └── For each article: inserts into `articles`
   └── Hero image pipeline (if hero_image_url present):
       └── fetch → sharp resize (max 1600 px wide, strip EXIF)
           └── write <hash>.webp + <hash>.jpg to MCP_IMAGE_DIR
           └── stores hash in articles.hero_image_hash
           └── failure is non-fatal — article still inserts, hash = null
   └── Upserts run_log row with articles_count

6. Agent calls ack_queue_item (HTTP POST /mcp/*)
   └── Sets queue.acked_at = now()
   └── Updates run_log terminal status + started_at / completed_at

7. cron: scheduler tick updates targets.last_run_at, next_due_at

8. Admin dashboard (browser)
   └── GET / → RSC renders masonry grid from `articles` table
   └── GET /api/events → SSE stream; new articles push event: article:new
       └── LiveArticleStream.tsx fades new tiles in without full grid reflow
```

---

## The reference agent

The agent that drives the queue is in the sibling repo
[`Project-LucidIndex-Agent`](https://github.com/lxrbckl-labs/Project-LucidIndex-Agent).
That repo ships in lockstep with this one (`v0.1.0` tags match).
LucidIndex itself contains no scraping, LLM calls, or summarization logic —
those live entirely in the agent.

---

## Where to learn more

**Design rationale and specs** live in the vault:

- `[[Architecture]]` — topology decisions, trade-offs, the "why"
- `[[Backend]]` — schema design, migration strategy, backup design
- `[[MCP]]` — MCP tool surface spec, claim-lock design, dedup approach
- `[[Visual Identity]]` — Fyrre Magazine reference, tile sizing rules, masonry grid

**Production deploy** — see [`docs/deploy.md`](deploy.md) for the full runbook:
DNS, Caddyfile snippet, `.env` configuration, founding-admin enrollment, first
agent run.

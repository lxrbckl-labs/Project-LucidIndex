# Project LucidIndex

> A **single-admin** personal intelligence magazine. You drop the handles and URLs you care about into your watch queue; your external AI agents pull from the queue, file articles back, and LucidIndex lays them out as a Fyrre-Magazine-style masonry dashboard.

> **Status:** Spec locked, no code yet. This README captures the v0.1 shape so the first scaffold (Phase 1 of the build plan) lands against a shared picture. The setup section is intentionally a TODO until Phase 1 ships.

---

## What it is

LucidIndex is the **cockpit and the magazine; the agents are the journalists.** You (the admin, singular) configure watch targets — a YouTube handle, an Instagram profile, an X account, a plain website URL, whatever you want followed. Your external agents pull targets one at a time from the queue, check them for new activity, summarize what they found, classify each finding with a topic badge, optionally cross-source it against related coverage, and write articles back. LucidIndex stores the articles, streams them live over SSE, and renders them as editorial tiles on a Fyrre-shaped masonry dashboard — sized by the agent's significance rating.

LucidIndex itself does not scrape, does not run an LLM, and does not ship agents. It is **infrastructure only**.

A reference agent ships in lockstep as a sibling repo: [`Project-LucidIndex-Agent`](https://github.com/lxrbckl-dev/Project-LucidIndex-Agent) (does not exist yet — scaffolded in Phase 4 of the build plan; both repos tag matching `v0.1.0` at ship). LucidIndex without LucidIndex-Agent is half a product.

---

## What LucidIndex is NOT building

- **The agents themselves** — external, bring-your-own. Wire up Claude Code (or anything else MCP-speaking) and point it at your `mcp-dashboard`.
- **Scraping tools or LLM intelligence** — agents already have Playwright, fetch, search, summarization. LucidIndex stores what comes back; it does not generate it.
- **Social-media API integrations** — no Twitter API keys, no YouTube Data API, no Instagram Graph. Agents access the web however they already do.
- **Multi-user / co-admin / team mode** — single-admin forever in v0.1.
- **A slash-command surface inside Claude Code** — the reference agent talks to `mcp-dashboard` directly via MCP.

---

## Architecture overview

LucidIndex deploys as four containerized services plus a host-resident reverse proxy that **lives outside this repo**.

| Service | Role |
|---|---|
| **`web`** | Next.js 15 app (App Router, RSC, Server Actions, Route Handlers). Owns the dashboard, article pages, settings, passkey auth, and the SSE stream. |
| **`cron`** | Sidecar Node process running `node-cron`. Sweeps targets due for re-enqueue, reaps stale claim-locks, runs retention purge, runs nightly local + off-site backups. Decoupled from web so cron lifecycle doesn't ride on HTTP request handling. |
| **`mcp-dashboard`** | Sidecar MCP server (`@modelcontextprotocol/sdk`). Exposes the agent surface over **Streamable HTTP** (bearer-token auth) and **stdio** (process-local trust). Decoupled because MCP transport lifecycle is different from HTTP. |
| **`postgres`** | Postgres 16. Source of truth for everything — articles, queue, targets, badges, templates, agent tokens, sessions, credentials. |

**Reverse proxy is host-resident.** TLS termination + public reach is handled by an existing Caddy on the host — **NOT shipped in this repo's `docker-compose.yml`** (same shape as Project-DS). Compose binds `web` and `mcp-dashboard` to `127.0.0.1:PORT` so only the host (and therefore Caddy) can reach them; Caddy fronts both behind a single hostname and routes `/mcp/*` to `mcp-dashboard`, everything else to `web`. Public reach is a DNS A record + port 443 forwarded to the host. **No tunnel daemon, no Cloudflare account, no Tailscale account.**

LucidIndex is **infrastructure only** — there are no agents, no scrapers, and no LLM/summarization pipeline anywhere in this stack. Those live in (or with) the reference agent repo.

Design notes (architecture deep-dive, MCP tool surface, schema, dashboard UX, Visual Identity, Plan of Attack, Debrief) live in Alex's Obsidian vault at `<vault>/Projects/Project-LucidIndex/`. See [`CLAUDE.md`](CLAUDE.md) for the vault-discovery instructions; this repo deliberately holds only `README.md`, `CLAUDE.md`, and code.

For a deeper look at the as-built implementation — service responsibilities, schema tables, data-flow walkthrough — see [`docs/architecture.md`](docs/architecture.md).

---

## Tech stack

| Layer | Tech |
|---|---|
| Web app | **Next.js 15** + **React 19** (App Router, RSC, Server Actions) |
| Styling | **Tailwind CSS v4** + **shadcn/ui** + Radix primitives + Lucide icons |
| Language / runtime | **TypeScript** strict + **Node 20 LTS** |
| Package manager | **pnpm** (workspaces) |
| Database | **PostgreSQL 16** via **Drizzle ORM** + Drizzle Kit (migrations) + `postgres-js` driver |
| Validation | **Zod** + **drizzle-zod** |
| Realtime | **SSE** via Next.js Route Handlers (Node runtime) |
| Search | Postgres FTS — `tsvector` generated column + GIN index |
| Auth | **Passkeys only** (WebAuthn) via **SimpleWebAuthn** + **iron-session** — ported from Project-Showalter |
| Agent surface | **`@modelcontextprotocol/sdk`** with **Streamable HTTP** (bearer-token) and **stdio** transports |
| Bearer-token hashing | **`@node-rs/argon2`** |
| Prompt templates | **LiquidJS** (sandboxed by default), rendered at queue-pull time |
| Image processing | **`sharp`** (resize, EXIF strip, WebP + JPEG output), local-disk storage under `data/images/` |
| Cron | **`node-cron`** in the `cron` sidecar; every tick logged to `cron_runs` for observability |
| Logging | **`pino`** (`pino-pretty` in dev, structured JSON in prod) |
| Lint + format | **Biome** |
| Pre-commit | **`lefthook`** |
| Testing | **Vitest** (unit/integration) + **Playwright** (E2E) |
| Container | **Docker Compose** — services: `web`, `cron`, `mcp-dashboard`, `postgres` |
| Reverse proxy | **Host-resident Caddy** with **automatic Let's Encrypt** via ACME — not shipped in our stack |

See `<vault>/Projects/Project-LucidIndex/Tech Stack.md` for the binding picks and the rationale behind each.

---

## Visual identity (binding)

The dashboard is styled after **Fyrre Magazine** — page-spanning wordmark, B&W editorial palette, hairline-bordered article cards with hero image on top, topic-badge pill row as filter chips, and a **CSS-Grid masonry of 6–8 explicit subdivision patterns** (not a uniform Pinterest-style grid). Tile size is driven by the agent's significance rating (`small` / `medium` / `large`). The full reference imagery and binding rules live at `<vault>/Projects/Project-LucidIndex/Visual Identity.md` and `<vault>/Projects/Project-LucidIndex/Design/`.

Visual Identity is a **first-class design constraint**, not a polish step. The Phase 5 gate is "screenshot side-by-side with `Design/main.jpg` reads as the same family" — if it doesn't, the phase isn't done.

---

## Founding-admin first-run

Single-admin enrollment is gated by an environment variable so the deploy window between "service is reachable" and "admin has claimed the account" is closed.

1. Operator (you) sets `LUCIDINDEX_FOUNDING_TOKEN=<random-string>` in the deploy environment before bringing the stack up.
2. First visit to `/settings?token=<token>` triggers the founding-admin claim:
   - The passkey-registration ceremony runs (SimpleWebAuthn).
   - On success: a one-time recovery code is displayed (copy it now — it's never shown again, and it's stored hashed).
   - The token is invalidated server-side. Subsequent visits to `/settings?token=...` with the same value are rejected.
3. After enrollment, `/settings` is **passkey-gated** — you sign in with your registered passkey. Dashboard and article pages stay public so share links unfurl for anyone; only `/settings` is gated. `mcp-dashboard` over HTTP is bearer-token gated; over stdio it relies on process-local trust.

**Recovery is the `admin:reset` CLI** run directly on the server (truncates sessions + credentials so the next visit re-claims via passkey re-registration). **No email/SMS fallback by design** — single-admin, homelab, you control the box. Same recovery posture as Project-DS and Project-Showalter.

---

## Reverse-proxy with host Caddy

LucidIndex deploys behind the **homelab's existing Caddy** — we do not ship a Caddy container. The host Caddy terminates TLS via automatic Let's Encrypt (ACME) and routes incoming traffic: `/mcp/*` goes to `mcp-dashboard` (port 4000), everything else goes to `web` (port 47892). There is **no tunnel daemon, no Cloudflare account, and no Tailscale account** in this picture — a public DNS A record, port 443 forwarded at the router, and Caddy's built-in ACME client are the entire public-reach stack.

### Caddyfile snippet

Drop this block into your existing Caddyfile, replacing `your-domain.com` with the hostname you own:

```caddyfile
your-domain.com {
    handle /mcp/* {
        reverse_proxy <mcp-target>:4000
    }
    handle {
        reverse_proxy <web-target>:47892
    }
}
```

Caddy auto-issues and auto-renews the TLS cert via Let's Encrypt — no extra configuration needed.

Pick `<web-target>` and `<mcp-target>` based on how Caddy runs on your host:

| Caddy deployment | `<web-target>` | `<mcp-target>` |
|---|---|---|
| **Native binary or systemd on the host** | `localhost` | `localhost` |
| **Docker container on the same host** (macOS / Docker Desktop) | `host.docker.internal` | `host.docker.internal` |
| **Docker container in the same network as this stack** | `web` | `mcp-dashboard` |

Details on each shape:

- **Caddy on the host directly** (native binary or systemd): use `localhost:47892` / `localhost:4000`. The Compose stack binds both services to `127.0.0.1:<port>`, so Caddy running on the same host can reach them at `localhost`.
- **Caddy in a Docker container on the same host** (most common self-hosted setup on macOS / Docker Desktop): use `host.docker.internal:47892` / `host.docker.internal:4000`. `localhost` inside the Caddy container points at the Caddy container itself, not the host — using `localhost` here will give you HTTP 502s.
- **Caddy in the same Docker network as the LucidIndex stack**: use the container names `web:47892` / `mcp-dashboard:4000`. This requires either attaching Caddy explicitly to this stack's Compose network, or adding `web` and `mcp-dashboard` to Caddy's network in `docker-compose.yml`.

### Compose port-binding posture

The Compose file already binds `web` to `127.0.0.1:47892` and `mcp-dashboard` to `127.0.0.1:4000`. This means only Caddy (running on the same host) can reach the services directly — the public internet sees them only through the reverse proxy. **Do not change these to `0.0.0.0:<port>` bindings** — that would expose the services directly on the public interface and defeat the security model.

### Reload Caddy after editing

After dropping the snippet into your Caddyfile, reload Caddy so the changes take effect:

- **Native / systemd:** `caddy reload --config /etc/caddy/Caddyfile` or `sudo systemctl reload caddy`
- **Containerized:** `docker exec caddy caddy reload --config /etc/caddy/Caddyfile` or `docker restart caddy`

---

## Deploy

The full step-by-step production deploy guide lives at **[`docs/deploy.md`](docs/deploy.md)**. It covers DNS, host Caddy setup, `.env` configuration, `docker compose up -d --build`, founding-admin enrollment, and first agent run.

Short version:

```sh
git clone https://github.com/lxrbckl-dev/Project-LucidIndex.git
cd Project-LucidIndex
cp apps/web/.env.example .env
# edit .env — set POSTGRES_PASSWORD, IRON_SESSION_PASSWORD,
#   WEBAUTHN_RP_ID, WEBAUTHN_ORIGIN, LUCIDINDEX_FOUNDING_TOKEN
docker compose up -d --build
# then visit https://your-domain.com/settings?token=<LUCIDINDEX_FOUNDING_TOKEN>
# to claim founding-admin and register your first passkey
```

See [`docs/deploy.md`](docs/deploy.md) for the full runbook, Caddy snippet, troubleshooting, and backup configuration.

---

## Setup

> **TODO — no code yet, this section will fill in once Phase 1 lands** (the foundation scaffold: pnpm monorepo, Next.js 15 app, Drizzle schema with first migration, `docker-compose.yml` for Postgres + web, founding-admin flow ported from Project-Showalter).

The intended shape will be roughly:

```
pnpm install
cp .env.example .env
# edit .env — set LUCIDINDEX_FOUNDING_TOKEN, POSTGRES_PASSWORD, DATABASE_URL,
#   PUBLIC_HOSTNAME, PUBLIC_ORIGIN, iron-session cookie key
docker compose up --build
```

Then visit `/settings?token=<LUCIDINDEX_FOUNDING_TOKEN>` to claim founding-admin and register your first passkey.

### Migrations on startup (production)

The web container runs Drizzle migrations + the idempotent seed before binding port 47892. The runner image bundles `drizzle-kit`, the SQL files under `packages/db/migrations/`, and the compiled `packages/db/dist/seed.js`. On a fresh database this materialises the schema; on a populated database the migration journal makes it a no-op. The healthcheck on `web` doubles as a "schema is ready" signal — `mcp-dashboard` and `cron` `depends_on: web → service_healthy` so they never query an unmigrated DB. There is no host-side `pnpm db:migrate` step in production.

Concrete commands, env var list, and the admin CLI surface (`admin:reset`) get written into this section once the scaffold exists.

### Demo data (`LUCIDINDEX_SEED_DEMO`)

Set `LUCIDINDEX_SEED_DEMO=true` (or `1` / `yes`, case-insensitive) on the `web` service to populate an **empty** database with a large synthetic fixture for stress-testing — ~50–80 targets across all source types, 15–25 topic badges, **800–1200 articles** with realistic titles, summaries, and recency-weighted publish dates, plus pending topic-badge suggestions, queue items, run-log entries, and cron-run history. Hero images are fetched from `picsum.photos` and run through the **same production image-pipeline** (`@lucidindex/shared/image-pipeline`) that `mcp-dashboard` uses for real agent writes — disk layout, content hashes, and WebP+JPEG outputs match exactly, so the dashboard's image route resolves seeded and real images identically.

The seeder hooks into the web entrypoint **after migrations apply** and is **fully idempotent**: it skips silently if `targets` or `articles` already has any row, so it's safe to leave on across container restarts. To re-seed a fresh fixture, tear down the volume (`docker compose down -v`) and bring the stack back up.

What it never seeds: `admins`, `credentials`, `recovery_codes`, `agent_tokens` (real ones — it inserts a single placeholder byline-only token), and `auth_events`. Those are governed by the founding-admin claim flow and the operator-issued token flow.

For ad-hoc invocation outside Docker, `pnpm db:seed-demo` runs the same script against `DATABASE_URL` directly. Faker is seeded with a fixed RNG seed (`42`) so every run against the same env produces identical fixtures — useful for reproducing stress-test results.

Default: `false`. Production deployments should leave this off.

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the quick-start, local dev loop, testing commands, migration workflow, and PR conventions. Short version: `pnpm install` then `pnpm test:e2e`.

---

## Status

Spec locked at v0.1 (single-admin, Fyrre-magazine masonry, Postgres + Drizzle, single Next.js app + cron + mcp-dashboard sidecars, host Caddy + Let's Encrypt deploy). Design notes and the build plan live in Alex's Obsidian vault at `<vault>/Projects/Project-LucidIndex/`. **No code yet** — Phase 0 (this docs rewrite) precedes Phase 1 (foundation scaffold). See `<vault>/Projects/Project-LucidIndex/Plan of Attack.md` for the full phase-by-phase build sequence.

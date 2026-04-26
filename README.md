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

- **The agents themselves** — external, bring-your-own. Wire up Claude Code (or anything else MCP-speaking) and point it at your `mcp-store`.
- **Scraping tools or LLM intelligence** — agents already have Playwright, fetch, search, summarization. LucidIndex stores what comes back; it does not generate it.
- **Social-media API integrations** — no Twitter API keys, no YouTube Data API, no Instagram Graph. Agents access the web however they already do.
- **Multi-user / co-admin / team mode** — single-admin forever in v0.1.
- **A slash-command surface inside Claude Code** — the reference agent talks to `mcp-store` directly via MCP.

---

## Architecture overview

LucidIndex deploys as four containerized services plus a host-resident reverse proxy that **lives outside this repo**.

| Service | Role |
|---|---|
| **`web`** | Next.js 15 app (App Router, RSC, Server Actions, Route Handlers). Owns the dashboard, article pages, settings, passkey auth, and the SSE stream. |
| **`cron`** | Sidecar Node process running `node-cron`. Sweeps targets due for re-enqueue, reaps stale claim-locks, runs retention purge, runs nightly local + off-site backups. Decoupled from web so cron lifecycle doesn't ride on HTTP request handling. |
| **`mcp-store`** | Sidecar MCP server (`@modelcontextprotocol/sdk`). Exposes the agent surface over **Streamable HTTP** (bearer-token auth) and **stdio** (process-local trust). Decoupled because MCP transport lifecycle is different from HTTP. |
| **`postgres`** | Postgres 16. Source of truth for everything — articles, queue, targets, badges, templates, agent tokens, sessions, credentials. |

**Reverse proxy is host-resident.** TLS termination + public reach is handled by an existing Caddy on the host — **NOT shipped in this repo's `docker-compose.yml`** (same shape as Project-DS). Compose binds `web` and `mcp-store` to `127.0.0.1:PORT` so only the host (and therefore Caddy) can reach them; Caddy fronts both behind a single hostname and routes `/mcp/*` to `mcp-store`, everything else to `web`. Public reach is a DNS A record + port 443 forwarded to the host. **No tunnel daemon, no Cloudflare account, no Tailscale account.**

LucidIndex is **infrastructure only** — there are no agents, no scrapers, and no LLM/summarization pipeline anywhere in this stack. Those live in (or with) the reference agent repo.

Design notes (architecture deep-dive, MCP tool surface, schema, dashboard UX, Visual Identity, Plan of Attack, Debrief) live in Alex's Obsidian vault at `<vault>/Projects/Project-LucidIndex/`. See [`CLAUDE.md`](CLAUDE.md) for the vault-discovery instructions; this repo deliberately holds only `README.md`, `CLAUDE.md`, and code.

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
| Container | **Docker Compose** — services: `web`, `cron`, `mcp-store`, `postgres` |
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
3. After enrollment, `/settings` is **passkey-gated** — you sign in with your registered passkey. Dashboard and article pages stay public so share links unfurl for anyone; only `/settings` is gated. `mcp-store` over HTTP is bearer-token gated; over stdio it relies on process-local trust.

**Recovery is the `admin:reset` CLI** run directly on the server (truncates sessions + credentials so the next visit re-claims via passkey re-registration). **No email/SMS fallback by design** — single-admin, homelab, you control the box. Same recovery posture as Project-DS and Project-Showalter.

---

## Deploy shape — host Caddy + Let's Encrypt, no tunnel

LucidIndex deploys with the same binding pattern as Project-DS: Compose brings up the four services and binds them to `127.0.0.1:PORT`; the host's existing Caddy fronts the deployment, terminates TLS via automatic Let's Encrypt (ACME), and routes `/mcp/*` to `mcp-store` and everything else to `web`. There is **no tunnel daemon, no Cloudflare account, and no Tailscale account** in this picture.

### Caddyfile snippet

Drop this into your existing Caddyfile, replacing `your-domain.com` with the hostname you own:

```caddyfile
your-domain.com {
    handle /mcp* {
        reverse_proxy <mcp-target>
    }
    handle {
        reverse_proxy <web-target>
    }
}
```

Pick the right `<web-target>` / `<mcp-target>` based on how Caddy runs on the host:

- **Caddy on the host directly** (native binary or systemd): `localhost:<web-port>` / `localhost:<mcp-port>`.
- **Caddy in a Docker container on the same host** (most common self-hosted setup on macOS / Docker Desktop): `host.docker.internal:<web-port>` / `host.docker.internal:<mcp-port>` — `localhost` inside the Caddy container points at Caddy itself, not the host, and you'll get HTTP 502s.
- **Caddy in the same Docker network as the LucidIndex stack**: use container names — `web:<port>` / `mcp-store:<port>`.

### Compose port-binding posture

Tighten Compose port bindings to `127.0.0.1:<port>:<container-port>` for both `web` and `mcp-store` so only Caddy (on the same host) can reach the services directly; the public internet gets them only through the reverse proxy.

### Public reach

A public DNS A record points at the homelab IP (DDNS if the IP isn't static), the home router forwards port 443 to the host, and Caddy auto-issues + auto-renews the cert via Let's Encrypt. That's the entire public-reach picture — no third-party account required.

### Reload Caddy after editing

`caddy reload --config /etc/caddy/Caddyfile`, `sudo systemctl reload caddy`, or `docker restart caddy` for the containerized variant.

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
pnpm db:migrate
```

Then visit `/settings?token=<LUCIDINDEX_FOUNDING_TOKEN>` to claim founding-admin and register your first passkey.

Concrete commands, env var list, and the admin CLI surface (`admin:reset`) get written into this section once the scaffold exists.

---

## Status

Spec locked at v0.1 (single-admin, Fyrre-magazine masonry, Postgres + Drizzle, single Next.js app + cron + mcp-store sidecars, host Caddy + Let's Encrypt deploy). Design notes and the build plan live in Alex's Obsidian vault at `<vault>/Projects/Project-LucidIndex/`. **No code yet** — Phase 0 (this docs rewrite) precedes Phase 1 (foundation scaffold). See `<vault>/Projects/Project-LucidIndex/Plan of Attack.md` for the full phase-by-phase build sequence.

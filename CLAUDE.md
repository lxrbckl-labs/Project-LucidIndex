# Project LucidIndex — Claude Code Orientation

This is the source-of-truth repository for Project LucidIndex. Read this before doing anything.

**Hard rule: do NOT destroy or wholesale rewrite existing documentation or code without explicit user approval.**

> **Design notes live in Obsidian, not in this repo.** Architecture, dashboard, MCP, backend, triggers, visual identity, the narrative debrief, feature-idea decisions, and design reference images live in Alex's Obsidian vault under `Projects/Project-LucidIndex/`. The repo now holds only this file (`CLAUDE.md`), `README.md`, and code. To find the vault path on Alex's machine: read `~/Library/Application Support/obsidian/obsidian.json`, parse the `vaults` map, and use the entry with `"open": true` (fall back to the most recent by `ts` if none are open). The Project-LucidIndex notes live at `<vault>/Projects/Project-LucidIndex/`. Wikilinks below (`[[Architecture]]`, etc.) resolve directly when the file is opened in Obsidian.

---

## What This Project Is

LucidIndex is a single-admin personal intelligence magazine. The admin adds watch targets (social handles and arbitrary URLs) to a queue and lets their external agents do the rounds. Agents pull targets from the queue, check them for new activity, summarize findings, classify each finding into a topic badge, and write back. LucidIndex surfaces the results on an editorially-styled magazine dashboard — Fyrre Magazine aesthetic, topic-badge filter pills, significance-driven masonry tiles.

LucidIndex is the infrastructure. It does not ship agents, scrapers, or summarization pipelines.

See [README.md](README.md) for the full pitch. See `[[Architecture]]` in the Obsidian vault for the layer breakdown.

---

## Where to Find Things

| What | Where |
|---|---|
| Project overview and north star | [README.md](README.md) (in repo) |
| Architecture (all layers) | `[[Architecture]]` (vault) |
| Narrative debrief | `[[Debrief]]` (vault) |
| MCP layer and `mcp-dashboard` (queue + write-back + topic badges) | `[[MCP]]` (vault) |
| Backend API, passkey auth, SSE, DB schema, admin CLI | `[[Backend]]` (vault) |
| Dashboard UX behavior (filters, sort, empty state) | `[[Dashboard]]` (vault) — visual rules defer to `[[Visual Identity]]` |
| **Visual design — binding for all visual decisions** | `[[Visual Identity]]` (vault) — Fyrre-derived card anatomy, palette, typography, masonry |
| Claude Code slash commands | `[[Claude Code]]` (vault) — stub only; slash commands were cut |
| Trigger system (cron / webhook / manual) | `[[Triggers]]` (vault) |
| Feature ideas / locked decisions (Rounds 1–7) | `[[Features (Ideas)]]` (vault) |
| Tech stack — locked framework topology | `[[Tech Stack]]` (vault) |
| Build sequence — phases 0–8 | `[[Plan of Attack]]` (vault) |
| Design references (`main.jpg`, `infinite_scroll.jpg`) | `<vault>/Projects/Project-LucidIndex/Design/Index.md` |

---

## Tech Stack

| Layer | Tech |
|---|---|
| Web app | Next.js 15 (App Router, Node runtime) + React 19 |
| Backend API | TypeScript + Next.js 15 (App Router, Node runtime) — no separate Fastify server |
| Database | Postgres 16 via Drizzle ORM (`postgres-js` driver, Drizzle Kit migrations) |
| MCP server | TypeScript + `@modelcontextprotocol/sdk` (`mcp-dashboard` sidecar) |
| Cron | TypeScript + `node-cron` sidecar |
| Realtime | SSE via Next.js Route Handlers |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Auth | Passkeys (WebAuthn via SimpleWebAuthn) + reusable `lipc_` passcode, on `iron-session`. First-admin claim is the on-page "Generate token" flow (no env-var gate) |
| Agent interface | External MCP clients via bearer-token auth |

### Deploy

Docker Compose stack — four services: `web`, `cron`, `mcp-dashboard`, `postgres`. No Caddy container in the stack — the host already runs Caddy. The host's Caddy terminates TLS via automatic Let's Encrypt (ACME — no signup, no third-party account). A Caddyfile snippet ships in the deploy docs for the host to absorb. Same shape as Project-DS deploys. No tunnel daemon, no Cloudflare account, no Tailscale account.

---

## Key Constraints

- **LucidIndex is infrastructure, not agents.** Do not build agent logic here. Agents are external.
- **No agent intelligence or scraping tools here.** Agents already have Playwright, fetch, search, etc. LucidIndex does not bundle any of it.
- **No social media API integrations.** No Twitter API keys, no YouTube Data API, no Instagram Graph. Agents access the web however they already do.
- **No LLM / summarization pipeline.** Summarization is whatever the agent does before write-back. LucidIndex stores what it receives.
- **Dashboard is read/write by the admin, write-only by agents.** Agents never touch the UI — they go through `mcp-dashboard`.
- **Single-admin.** v0.1 is one admin only. There is no shared cross-admin data — there's only one admin. Multi-admin is parking lot (not v0.1).
- **Passkey auth only.** No email/password, no magic link, no OAuth. No email/SMS fallback by design.
- **Recovery is the recovery code, redeemed on the web.** "Lost your passkey?" on `/settings/login` → `/settings/recover`: the admin enters their one-time recovery code, which authorizes enrolling a NEW passkey (old code burned, fresh one issued). Routes: `/api/auth/recovery/{start,finish,finalize}`; logic in `@lucidindex/auth` (`recovery-login.ts` + the seam-tested `recovery-login-core.ts`); brute-force throttle in `apps/web/lib/recovery-throttle.ts`. This supersedes the originally-planned `admin:reset` CLI, which was never built.
- **Founding-admin claim only.** No invite-based signup. On a fresh install (zero admins), `/settings` shows "Claim Admin" → **Generate token** mints a reusable `lipc_` passcode (saved as the backup sign-in) and signs you in, then you enroll a passkey (primary). **First claim wins**; the gate closes once an admin exists. The `LUCIDINDEX_FOUNDING_TOKEN` env var is no longer used — founding is the on-page Generate flow (`claimFoundingAdmin` / `POST /api/auth/founding/claim`). No open registration.
- **Visual Identity is a first-class constraint.** If the dashboard doesn't read like Fyrre Magazine, it's not done — regardless of whether it works functionally. All visual decisions must consult `[[Visual Identity]]` first.

---

## Current Status

The web app is built and runs: the Fyrre-styled dashboard + article pages, the forum, passkey + reusable-passcode auth, the founding-admin claim, `mcp-dashboard` + `mcp-forum`, and the cron sidecar. Day-to-day work is iterative feature/UX refinement in **dev mode** (see the `next-dev` skill) — the Docker/production stack is parked, not the current focus. The full spec still lives in the vault (`[[Tech Stack]]`, `[[Visual Identity]]`, `[[Features (Ideas)]]`, `[[Plan of Attack]]`).

Founding-admin is the on-page **"Generate token"** flow (no env-var token) — see Key Constraints. The reference agent repo (`Project-LucidIndex-Agent`) does not exist yet — it is a Phase 4 deliverable.

> Update this section as phases complete — what's built, what's in progress, what's next.

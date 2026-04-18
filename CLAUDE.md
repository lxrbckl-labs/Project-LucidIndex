# Project LucidIndex — Claude Code Orientation

This is the source-of-truth repository for Project LucidIndex. Read this before doing anything.

**Hard rule: do NOT destroy or wholesale rewrite existing documentation or code without explicit user approval.**

---

## What This Project Is

LucidIndex is a multi-user personal intelligence forum. Each user logs in (passkey only), adds watch targets (social handles and arbitrary URLs) to their personal queue, and lets their own external agents do the rounds. Agents pull targets from the queue, check them for new activity, summarize findings, classify each finding into a genre, and write back. LucidIndex surfaces the findings on a TweetDeck-shaped dashboard — one column per genre.

LucidIndex is the infrastructure. It does not ship agents, scrapers, or summarization pipelines.

See [README.md](README.md) for the full pitch. See [ARCHITECTURE.md](ARCHITECTURE.md) for the layer breakdown.

---

## Where to Find Things

| What | Where |
|---|---|
| Narrative debrief | [DEBRIEF.md](DEBRIEF.md) |
| Project overview and north star | [README.md](README.md) |
| Architecture (all 5 layers) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| MCP layer and `mcp-store` (queue + write-back + genres) | [docs/mcp.md](docs/mcp.md) |
| Backend API, passkey auth, SSE, DB schema, admin CLI | [docs/backend.md](docs/backend.md) |
| Dashboard UI vision (TweetDeck columns, card anatomy) | [docs/dashboard.md](docs/dashboard.md) |
| Claude Code slash commands | [docs/claude-code.md](docs/claude-code.md) |
| Trigger system (cron / webhook / manual) | [docs/triggers.md](docs/triggers.md) |

---

## Tech Stack

| Layer | Tech |
|---|---|
| MCP servers | TypeScript |
| Backend API | TypeScript + Fastify |
| Database | SQLite via `better-sqlite3` |
| Dashboard | Next.js + Tailwind + shadcn/ui |
| Realtime | SSE, auth'd per user |
| Agent interface | Claude Code + MCP protocol |
| Auth | Passkeys only (WebAuthn) |

---

## Key Constraints

- **LucidIndex is infrastructure, not agents.** Do not build agent logic here. Agents are external and user-supplied.
- **No agent intelligence or scraping tools here.** Agents already have Playwright, fetch, search, etc. via Claude Code. LucidIndex does not bundle any of it.
- **No social media API integrations.** No Twitter API keys, no YouTube Data API, no Instagram Graph. Agents access the web however they already do.
- **No LLM / summarization pipeline.** Summarization is whatever the agent does before write-back. LucidIndex stores what it receives.
- **Dashboard is read/write by the user, write-only by agents.** Agents never touch the UI directly — they go through `mcp-store`.
- **Per-user isolation.** Targets, findings, genres, favorites are all user-scoped. Users cannot see each other's data. Findings are independent per user — if two users watch the same handle, each gets their own agent runs and their own summaries.
- **Passkey auth only.** No email/password, no magic link, no OAuth. Recovery is `admin:reset` CLI. No email/SMS fallback by design.
- **Invite-only signup (v0.1).** Invite codes come from `admin:invite`. Open signup is deferred.

---

## Current Status

Docs have been redrafted to match the queue-based, multi-user, passkey-authed, genre-column design. No code yet. All nine docs now tell one consistent story; v0.1 shape is locked in (queue pull-model, passkey auth, agent-classified genres, TweetDeck columns, Fastify). Next: begin implementation against these specs, starting with `mcp-store` and the Fastify backend.

> TODO: Update this section as the project progresses — what's built, what's in progress, what's next.

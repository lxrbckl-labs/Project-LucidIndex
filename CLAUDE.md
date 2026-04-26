# Project LucidIndex — Claude Code Orientation

This is the source-of-truth repository for Project LucidIndex. Read this before doing anything.

**Hard rule: do NOT destroy or wholesale rewrite existing documentation or code without explicit user approval.**

> **Design notes live in Obsidian, not in this repo.** Architecture, dashboard, MCP, backend, triggers, claude-code orientation notes, the narrative debrief, feature-idea decisions, and design reference images were migrated out of `docs/` and `ideas/` to Alex's Obsidian vault under `Projects/Project-LucidIndex/`. The repo now holds only this file (`CLAUDE.md`), `README.md`, and code. To find the vault path on Alex's machine: read `~/Library/Application Support/obsidian/obsidian.json`, parse the `vaults` map, and use the entry with `"open": true` (fall back to the most recent by `ts` if none are open). The Project-LucidIndex notes live at `<vault>/Projects/Project-LucidIndex/`. Wikilinks below (`[[Architecture]]`, etc.) resolve directly when the file is opened in Obsidian.

---

## What This Project Is

LucidIndex is a multi-user personal intelligence forum. Each user logs in (passkey only), adds watch targets (social handles and arbitrary URLs) to their personal queue, and lets their own external agents do the rounds. Agents pull targets from the queue, check them for new activity, summarize findings, classify each finding into a genre, and write back. LucidIndex surfaces the findings on a TweetDeck-shaped dashboard — one column per genre.

LucidIndex is the infrastructure. It does not ship agents, scrapers, or summarization pipelines.

See [README.md](README.md) for the full pitch. See `[[Architecture]]` in the Obsidian vault for the layer breakdown.

---

## Where to Find Things

| What | Where |
|---|---|
| Project overview and north star | [README.md](README.md) (in repo) |
| Architecture (all 5 layers) | `[[Architecture]]` (vault) |
| Narrative debrief | `[[Debrief]]` (vault) |
| MCP layer and `mcp-store` (queue + write-back + genres) | `[[MCP]]` (vault) |
| Backend API, passkey auth, SSE, DB schema, admin CLI | `[[Backend]]` (vault) |
| Dashboard UI vision (TweetDeck columns, card anatomy) | `[[Dashboard]]` (vault) |
| Claude Code slash commands | `[[Claude Code]]` (vault) |
| Trigger system (cron / webhook / manual) | `[[Triggers]]` (vault) |
| Feature ideas / locked decisions | `[[Features (Ideas)]]` (vault) |
| Design references (vibe images for main page + infinite scroll) | `<vault>/Projects/Project-LucidIndex/Design/Index.md` |

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

Nine design docs were redrafted to match the queue-based, multi-user, passkey-authed, genre-column design and now live in the Obsidian vault under `Projects/Project-LucidIndex/`; v0.1 shape is locked in (queue pull-model, passkey auth, agent-classified genres, TweetDeck columns, Fastify). No code yet. Next: begin implementation against these specs, starting with `mcp-store` and the Fastify backend.

> TODO: Update this section as the project progresses — what's built, what's in progress, what's next.

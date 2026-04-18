# Project LucidIndex

> A multi-user personal intelligence forum. You add the handles and URLs you want watched; your agents pull from the queue and file back findings; LucidIndex arranges them into a TweetDeck-shaped dashboard.

---

## What Is LucidIndex?

LucidIndex is the infrastructure between you and your AI agents. You log in, add watch targets to your personal queue (a YouTube handle, an Instagram profile, an X account, a plain website URL), and let your agents do the rounds. Agents **pull** from the queue on their own cadence, check each target for new activity, summarize what they found, and write the findings back. LucidIndex stores the findings, classifies them into columns on your dashboard, and keeps the whole thing private per user.

Think of it as a forum of your own making — one column per genre, one card per finding, organized by agents that you brought and configured yourself.

**North star:** Log in, open your dashboard to a forum of columns — each genre a column, each card a fresh finding your agents surfaced overnight from the handles and URLs you asked them to watch.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full layer breakdown.

---

## What LucidIndex Is NOT Building

- **The agents themselves** — external, bring-your-own. You wire up your own Claude Code, your own workflow, your own prompts.
- **Agent intelligence or scraping tools** — agents already have web traversal tools (Playwright, fetch, search). LucidIndex does not ship any of that.
- **Social media API integrations** — no Twitter API keys, no YouTube Data API, no Instagram Graph. Agents use general web access.
- **An LLM or summarization pipeline** — summarization is whatever the agent does. LucidIndex just stores what comes back.

---

## Architecture Layers (Overview)

| Layer | Description |
|---|---|
| **MCP Layer** | `mcp-store` — pull/lock/ack queue, findings write-back, expose user genres for classification, track per-target high-water marks |
| **Backend** | TypeScript + Fastify — passkey auth, REST API for targets/findings/genres, SSE per user, SQLite persistence |
| **Dashboard** | Next.js + Tailwind + shadcn/ui — TweetDeck-shaped genre columns, right-drawer detail, star/read/search |
| **Claude Code integration** | Slash commands — `/lucidindex run`, `/lucidindex add-target`, `/lucidindex status` |
| **Trigger system** | Cron re-enqueues targets due for a check, webhook re-enqueues a specific target, manual via slash command |

Full detail: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Tech Stack

| Layer | Tech |
|---|---|
| MCP servers | TypeScript |
| Backend API | TypeScript + Fastify |
| Database | SQLite via `better-sqlite3` |
| Dashboard | Next.js + Tailwind + shadcn/ui |
| Realtime | SSE (Server-Sent Events), auth'd per user |
| Agent interface | Claude Code + MCP protocol |
| Auth | Passkeys only (WebAuthn) |

---

## Documentation

- [DEBRIEF.md](DEBRIEF.md) — narrative project debrief (what LucidIndex is, the cockpit metaphor, the north star)
- [ARCHITECTURE.md](ARCHITECTURE.md) — the five layers in detail
- [docs/mcp.md](docs/mcp.md) — MCP layer and `mcp-store` (queue + write-back + genres + high-water marks)
- [docs/backend.md](docs/backend.md) — backend API, passkey auth, SSE, DB schema, admin CLI
- [docs/dashboard.md](docs/dashboard.md) — TweetDeck column layout, card anatomy, settings, UX (dump UI ideas here)
- [docs/claude-code.md](docs/claude-code.md) — `/lucidindex` slash commands
- [docs/triggers.md](docs/triggers.md) — cron, webhook, manual triggers, lifecycle

---

## Setup

> TODO: Fill in setup instructions once the project is initialized — repo structure, install steps, env vars, admin CLI (`admin:invite`, `admin:reset`), how to run locally.

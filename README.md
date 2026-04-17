# Project Lucidex

> AI agent-operated social media and web intelligence platform. Agents monitor the web; Lucidex surfaces the results.

---

## What Is Lucidex?

Lucidex is the infrastructure connecting autonomous AI agents to a clean intelligence dashboard. You configure what to watch — topics, authors, keywords, sources. Agents do the monitoring and summarization. Lucidex is the cockpit that gives them instruments and gives you a readout.

**North star:** Open your dashboard in the morning to a fully briefed readout of everything meaningful that happened online about the topics you care about — compiled, summarized, and organized overnight.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full layer breakdown.

---

## What Lucidex Is NOT Building

- The agents themselves (external, bring your own intelligence)
- Social media API integrations (agents use web search)
- An LLM or summarization pipeline (that's the agents' job)

---

## Architecture Layers (Overview)

| Layer | Description |
|---|---|
| **MCP Layer** | Agents' toolkit — mission config, write-back, deduplication |
| **Backend** | TypeScript API server — receives summaries, persists, pushes SSE |
| **Dashboard** | Next.js + Tailwind + shadcn/ui — live feed, filters, config editor |
| **Claude Code integration** | Slash commands — `/lucidex run`, `/lucidex add-topic`, etc. |
| **Trigger system** | Cron, webhooks, manual slash command triggers |

Full detail: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Tech Stack

| Layer | Tech |
|---|---|
| MCP servers | TypeScript |
| Backend API | TypeScript (Hono or Fastify — TBD) |
| Database | SQLite via `better-sqlite3` |
| Dashboard | Next.js + Tailwind + shadcn/ui |
| Realtime | SSE (Server-Sent Events) |
| Agent interface | Claude Code + MCP protocol |

---

## Documentation

- [DEBRIEF.md](DEBRIEF.md) — narrative project debrief (what Lucidex is, the cockpit metaphor, the north star)
- [ARCHITECTURE.md](ARCHITECTURE.md) — architecture layers in detail
- [docs/mcp.md](docs/mcp.md) — MCP layer and mcp-store
- [docs/backend.md](docs/backend.md) — backend API and SSE
- [docs/dashboard.md](docs/dashboard.md) — dashboard UI (dump your UI ideas here)
- [docs/claude-code.md](docs/claude-code.md) — slash commands
- [docs/triggers.md](docs/triggers.md) — trigger system

---

## Setup

> TODO: Fill in setup instructions once the project is initialized — repo structure, install steps, env vars, how to run locally.

# Architecture

Lucidex is built in five layers. Agents write findings to the MCP layer; the backend ingests and serves them; the dashboard presents them. See [README.md](README.md) for the project overview.

---

## Layer 1: MCP Layer

The agents' toolkit. All agent interactions with Lucidex flow through MCP servers.

### Core: `mcp-store`

The central MCP server that all agents connect to.

**Responsibilities:**

- **Mission config** — agents read what topics, authors, and keywords they are tasked to monitor
- **Write-back** — agents POST summaries and findings after each sweep
- **History queries** — agents query past findings to avoid redundant work
- **Deduplication** — content deduplication across multiple agent runs

See [docs/mcp.md](docs/mcp.md) for schema detail and planned additional MCP servers.

---

## Layer 2: Backend

Lightweight API server sitting between the MCP layer and the dashboard.

- Receives POSTed summaries from agents (via MCP or direct)
- Persists findings to SQLite
- Pushes realtime updates to the dashboard via SSE
- Framework: Hono or Fastify (TBD — see [docs/backend.md](docs/backend.md))
- Database: SQLite via `better-sqlite3`

See [docs/backend.md](docs/backend.md) for endpoints, SSE event types, and DB schema.

---

## Layer 3: Dashboard

The user-facing readout. Built with Next.js + Tailwind + shadcn/ui.

**Key views:**

- Live feed of findings — filterable by topic, source, author
- Search across history
- Config editor — manage what agents are watching
- Run history and activity log
- Digest view — longer-form summaries

See [docs/dashboard.md](docs/dashboard.md) for UI vision, layout notes, and component specs. **That file is the place to dump UI ideas.**

---

## Layer 4: Claude Code Integration

Slash commands for triggering and interacting with Lucidex from Claude Code sessions.

| Command | Purpose |
|---|---|
| `/lucidex run` | Trigger a sweep |
| `/lucidex add-topic` | Add a new topic to the watch list |
| `/lucidex digest` | Generate a digest summary |
| `/lucidex status` | Show current run status and agent activity |

See [docs/claude-code.md](docs/claude-code.md) for behavior specs and implementation notes.

---

## Layer 5: Trigger System

How sweeps are initiated.

| Trigger type | Description |
|---|---|
| **Cron** | Scheduled — runs on a timer (e.g., nightly) |
| **Manual** | Via Claude Code slash commands |
| **Webhook** | Event-driven — external systems push a trigger |

See [docs/triggers.md](docs/triggers.md) for config formats, webhook endpoints, and trigger lifecycle.

---

## System Diagram

```
External Agents (bring your own)
        │
        │  MCP protocol
        ▼
  ┌─────────────┐
  │  MCP Layer  │  mcp-store: mission config, write-back, dedup, history
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │   Backend   │  TypeScript API — ingest, persist, SSE push
  └──────┬──────┘
         │  SSE
         ▼
  ┌─────────────┐
  │  Dashboard  │  Next.js + Tailwind + shadcn/ui
  └─────────────┘

  ┌──────────────────┐
  │  Claude Code     │  /lucidex slash commands → triggers backend
  └──────────────────┘

  ┌──────────────────┐
  │  Trigger System  │  cron / webhooks / manual
  └──────────────────┘
```

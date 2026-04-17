# Project Lucidex — Claude Code Orientation

This is the source-of-truth repository for Project Lucidex. Read this before doing anything.

**Hard rule: do NOT destroy or wholesale rewrite existing documentation or code without explicit user approval.**

---

## What This Project Is

Lucidex is an AI agent-operated web intelligence platform. Agents autonomously monitor the web and surface structured, summarized intelligence to a dashboard. You configure what to watch; agents do the work; Lucidex connects them.

See [README.md](README.md) for the full pitch. See [ARCHITECTURE.md](ARCHITECTURE.md) for the layer breakdown.

---

## Where to Find Things

| What | Where |
|---|---|
| Narrative debrief | [DEBRIEF.md](DEBRIEF.md) |
| Project overview and north star | [README.md](README.md) |
| Architecture (all 5 layers) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| MCP layer and mcp-store | [docs/mcp.md](docs/mcp.md) |
| Backend API and SSE | [docs/backend.md](docs/backend.md) |
| Dashboard UI vision | [docs/dashboard.md](docs/dashboard.md) |
| Claude Code slash commands | [docs/claude-code.md](docs/claude-code.md) |
| Trigger system | [docs/triggers.md](docs/triggers.md) |

---

## Tech Stack

| Layer | Tech |
|---|---|
| MCP servers | TypeScript |
| Backend API | TypeScript (Hono or Fastify — TBD) |
| Database | SQLite via `better-sqlite3` |
| Dashboard | Next.js + Tailwind + shadcn/ui |
| Realtime | SSE |
| Agent interface | Claude Code + MCP protocol |

---

## Key Constraints

- Lucidex is the infrastructure, not the agents. Do not build agent logic here.
- No social media API integrations — agents use web search.
- No LLM/summarization pipeline — that is the agents' responsibility.
- Dashboard is read-only from the agents' perspective — agents write to MCP, not directly to the dashboard.

---

## Current Status

> TODO: Update this section as the project progresses — what's built, what's in progress, what's next.

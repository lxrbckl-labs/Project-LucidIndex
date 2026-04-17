# Project Lucidex — Debrief

## What it is
Lucidex is an AI agent-operated social media and web intelligence platform. A team of AI agents autonomously monitors the web — social media, forums, YouTube, news — and surfaces structured, summarized intelligence to you through a clean dashboard. You configure what to watch, the agents do the work, and Lucidex is the infrastructure that connects them.

---

## The metaphor
You're building the cockpit. The agents are the pilots. Lucidex gives them instruments to fly with and gives you a readout of everything they've found.

---

## Architecture layers

### 1. MCP Layer — the agents' toolkit
A set of MCP servers that give agents structured tools to interact with the Lucidex system. The core server is `mcp-store`, which handles everything agents need to read and write:
- Read their mission config (topics, authors, keywords to watch)
- Write summaries and findings back to the system
- Query history to avoid redundant work
- Deduplicate content across runs

### 2. Backend — the data layer
A lightweight API server that sits between the MCP layer and the dashboard. Receives POSTed summaries from agents, persists them, and pushes realtime updates to the dashboard via SSE.

### 3. Dashboard — your readout
A Next.js + Tailwind + shadcn/ui frontend. This is what you actually look at. Features will include:
- A live feed of agent findings organized by topic/source/author
- Filters and search across historical runs
- Config editor for managing what agents are tasked to watch
- Run history and agent activity log
- Digest view for longer-form summaries

### 4. Claude Code integration — conversational control
Slash commands that let you talk to Lucidex directly from Claude Code without opening the dashboard:
- `/lucidex run` — trigger an immediate agent sweep
- `/lucidex add-topic` — add a new topic to the watch config
- `/lucidex digest` — pull a summary of recent findings
- `/lucidex status` — see what's been run and when

### 5. Trigger system — how runs get initiated
- **Cron** — scheduled sweeps on a cadence you define
- **Claude Code slash commands** — on-demand manual runs
- **Webhooks** — event-driven triggers from external sources

---

## Tech stack

| Layer | Tech |
|---|---|
| MCP servers | TypeScript |
| Backend API | TypeScript (Hono or Fastify) |
| Database | SQLite via `better-sqlite3` |
| Dashboard | Next.js + Tailwind + shadcn/ui |
| Realtime | SSE (Server-Sent Events) |
| Agent interface | Claude Code + MCP protocol |

---

## What Lucidex is NOT building
- The agents themselves — they're external and bring their own intelligence
- Social media API integrations — agents use web search and their own capabilities
- An LLM or summarization pipeline — that's the agents' job

---

## The north star
At full operation, you open the Lucidex dashboard in the morning and have a fully briefed readout of everything meaningful that happened online about the topics you care about — compiled, summarized, and organized overnight by your agent team, without you lifting a finger.

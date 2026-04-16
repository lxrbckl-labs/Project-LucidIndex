# Backend API

The backend is a lightweight TypeScript API server that sits between the MCP layer and the dashboard. It receives findings from agents, persists them to SQLite, and pushes realtime updates to the dashboard via SSE. See [ARCHITECTURE.md](../ARCHITECTURE.md) for context.

---

## Overview

- Ingests summaries/findings written by agents (via MCP write-back or direct POST)
- Persists to SQLite using `better-sqlite3`
- Serves dashboard data via REST endpoints
- Pushes live updates to connected dashboard clients via SSE

---

## Framework Decision

**Hono vs. Fastify — TBD.**

> TODO: Make the framework call. Key considerations: edge deployment compatibility (Hono), ecosystem/plugins (Fastify), team familiarity, middleware needs. Document the decision and rationale here once made.

---

## API Endpoints

> TODO: Define the REST API surface. Consider:
> - `GET /findings` — list findings, with filter params (topic, source, author, date range)
> - `GET /findings/:id` — single finding detail
> - `POST /findings` — ingest a new finding (called by MCP layer or agent directly)
> - `GET /topics` — list configured topics/watch targets
> - `POST /topics` — add a new topic (via `/lucidex add-topic`)
> - `GET /runs` — run history and activity log
> - `GET /status` — current agent activity and system status
> Document each endpoint: method, path, request shape, response shape, auth (if any).

---

## SSE Event Types

> TODO: Define the SSE event stream. What events does the backend push to connected dashboard clients? Consider:
> - `finding:new` — a new finding has been ingested
> - `run:started` / `run:completed` — agent sweep lifecycle
> - `topic:added` — a new topic was added to the watch list
> Document each event: event name, payload shape, when it fires.

---

## Database Schema

> TODO: Define the SQLite schema. Tables to consider:
> - `findings` — persisted agent findings
> - `topics` — mission config (what to watch)
> - `runs` — sweep run history and metadata
> - `dedup_log` — deduplication tracking
> Document table names, columns, types, indexes.

---

## Error Handling

> TODO: Document error handling strategy — how API errors are shaped, how ingest failures are handled (retry? dead letter?), how SSE reconnects are handled.

---

## Local Development

> TODO: How to run the backend locally — install, env vars, start command, how to point agents at it.

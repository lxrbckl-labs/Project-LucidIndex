# MCP Layer

The MCP (Model Context Protocol) layer is the agents' toolkit — everything agents need to read their mission and write back their findings. See [ARCHITECTURE.md](../ARCHITECTURE.md) for context.

---

## Overview

Agents connect to Lucidex via MCP. The MCP layer exposes tools that agents use to:

1. Read their mission configuration (what to monitor)
2. Write back summaries and findings
3. Query history to avoid redundant work
4. Deduplicate content across runs

---

## mcp-store

The core MCP server. All agents interact with this server.

### Responsibilities

- Serve mission config to agents on request
- Accept POSTed summaries/findings from agents
- Respond to history queries (has this URL/topic been seen before?)
- Handle deduplication across concurrent and sequential agent runs

### Mission Config Schema

> TODO: Define the schema for mission configs — what fields does a "topic" have? What does an "author watch" look like? What are valid source types? Document the shape agents will receive when they ask for their mission.

### Summary / Finding Schema

> TODO: Define the schema for findings that agents write back — required fields (topic, source, url, summary, timestamp, etc.), optional fields, validation rules.

### MCP Tool Definitions

> TODO: List the MCP tools exposed by mcp-store — tool names, input schemas, return schemas. E.g., `get_mission`, `write_finding`, `query_history`, `check_duplicate`.

---

## Other Planned MCP Servers

> TODO: Are there additional MCP servers planned beyond mcp-store? (e.g., a dedicated search server, a config management server, a notification server?) List them here with a one-line purpose statement each.

---

## Implementation Notes

> TODO: Notes on the TypeScript MCP server setup — how it's structured, how it connects to the SQLite backend, how agents discover it, local dev setup.

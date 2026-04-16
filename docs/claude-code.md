# Claude Code Integration

Lucidex exposes slash commands for triggering and interacting with the platform from Claude Code sessions. See [ARCHITECTURE.md](../ARCHITECTURE.md) for context.

---

## Overview

Four slash commands cover the primary interactions: triggering sweeps, adding topics, generating digests, and checking status. These commands are the manual trigger surface for the platform — see [docs/triggers.md](triggers.md) for the full trigger system including cron and webhooks.

---

## `/lucidex run`

Trigger a sweep — tells agents to go do their work now.

> TODO: Define the behavior spec:
> - What exactly happens when this command runs?
> - Does it trigger all agents or a specific topic/agent?
> - Can you pass arguments (e.g., `/lucidex run --topic "AI news"`)?
> - What feedback does the user get? Immediate status, or check back with `/lucidex status`?
> - How does it interact with the trigger system (see [triggers.md](triggers.md))?

---

## `/lucidex add-topic`

Add a new topic to the watch list.

> TODO: Define the behavior spec:
> - What arguments does it take? (topic name, keywords, source types, author list?)
> - Is it interactive (prompts the user) or does it take arguments inline?
> - Where does it write the config? (via backend API → SQLite → picked up by mcp-store)
> - Does it immediately run a sweep for the new topic, or wait for the next scheduled run?

---

## `/lucidex digest`

Generate a digest summary of recent findings.

> TODO: Define the behavior spec:
> - What time window does the digest cover? (last 24h? configurable?)
> - What format is the output? (markdown summary per topic? single narrative?)
> - Does it render in the Claude Code terminal, push to the dashboard, or both?
> - Can you scope it? (e.g., `/lucidex digest --topic "AI news"`)

---

## `/lucidex status`

Show current run status and agent activity.

> TODO: Define the behavior spec:
> - What does it output? (last run time, next scheduled run, active agents, recent finding count?)
> - Does it pull from the backend API or check some local state?
> - Useful for: "did the overnight sweep run? did it find anything?"

---

## Implementation Notes

> TODO: Notes on how these slash commands are implemented:
> - Where do the command definitions live in the repo?
> - How do they call the backend API?
> - Auth/credentials — how does the CLI know where the backend is?
> - Local dev setup for testing commands against a local backend instance.

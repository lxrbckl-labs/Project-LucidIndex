# Trigger System

The trigger system controls how and when agent sweeps are initiated. Three trigger types: scheduled (cron), manual (slash commands), and event-driven (webhooks). See [ARCHITECTURE.md](../ARCHITECTURE.md) for context.

---

## Overview

Agents don't poll — they're triggered. Lucidex provides three ways to fire a sweep:

| Trigger type | How | When |
|---|---|---|
| **Cron** | Scheduled timer | Nightly, hourly, or custom schedule |
| **Manual** | Claude Code slash commands | On demand via `/lucidex run` |
| **Webhook** | HTTP POST from external system | Event-driven external trigger |

See [docs/claude-code.md](claude-code.md) for slash command details.

---

## Cron Triggers

Scheduled triggers that run on a timer.

> TODO: Define the cron trigger config format:
> - Where is the schedule configured? (config file, env var, dashboard config editor?)
> - What's the config schema? (cron expression, topic scope, agent target?)
> - Example config snippet.
> - How does the cron runner invoke agents? (direct call, webhook to self, queued job?)
> - How are missed runs handled?

---

## Webhook Triggers

Event-driven triggers — external systems push a request to fire a sweep.

> TODO: Define the webhook surface:
> - Endpoint path(s) — e.g., `POST /webhooks/trigger`
> - Request payload schema — what must the caller send?
> - Authentication — how are webhook callers authenticated? (shared secret, HMAC, API key?)
> - What sweeps are triggered — all agents, a specific topic, a named workflow?
> - Response shape — what does the caller get back?
> - Use cases: GitHub Actions triggering a post-deploy sweep, external cron service, Zapier/n8n integration.

---

## Manual Triggers

On-demand triggers via Claude Code slash commands.

> TODO: Cross-reference to [docs/claude-code.md](claude-code.md) `/lucidex run`. Any additional manual trigger surface (dashboard button? API call from terminal?) document here.

---

## Trigger Lifecycle

What happens from trigger fire to finding in the dashboard.

> TODO: Walk through the full trigger lifecycle:
> 1. Trigger fires (cron / webhook / slash command)
> 2. Backend receives trigger, creates a run record
> 3. Agent(s) are invoked — how? (direct function call, message queue, MCP call?)
> 4. Agent reads mission config from mcp-store
> 5. Agent does its sweep
> 6. Agent writes findings back to mcp-store
> 7. Backend picks up findings, persists to SQLite
> 8. Backend pushes SSE event to dashboard
> 9. Dashboard updates live
> Document each step with implementation notes once built.

---

## Error Handling & Retries

> TODO: What happens when a triggered sweep fails partway through?
> - Is the run marked failed in the run history?
> - Are partial findings kept or discarded?
> - Is there a retry mechanism?
> - How does the user find out a sweep failed?

# Trigger System

The trigger system controls how targets become **ready** on the queue. Three trigger types: scheduled (cron), event-driven (webhook), and manual (slash command). See [ARCHITECTURE.md](./ARCHITECTURE.md) for context.

---

## Overview

LucidIndex is pull-model. **A trigger never invokes an agent directly.** A trigger simply re-enqueues targets — makes them ready on the queue — and external agents (connected via `mcp-store`) pull when they pull.

| Trigger type | How | When |
|---|---|---|
| **Cron** | Scheduler re-enqueues targets whose cadence is due | Default hourly; per-target configurable |
| **Webhook** | External system POSTs to re-enqueue a specific target | Event-driven external trigger |
| **Manual** | Claude Code slash command | On demand via `/lucidindex run` |

See [docs/claude-code.md](claude-code.md) for slash command details and [docs/backend.md](backend.md) for the underlying endpoints.

---

## Cron Triggers

The scheduler ticks on its own, inspects each active target's `next_due_at`, and re-enqueues targets whose cadence is due.

**Design notes:**

- **Default cadence: hourly.** Configurable per target at creation or via the Queue page.
- Cadence is stored per target (named preset or cron expression).
- The scheduler is a background process inside the backend process (v0.1 simplicity — no separate service).
- Re-enqueue = insert a `queue` row in `ready` state for that target (or reset an existing one if still pending). No duplicate ready items per target at a time.

> TODO: Decide precise scheduler implementation — an in-process `setInterval` with minute-resolution sweep? Per-target timers? Pick at implementation time. Also decide missed-run policy: if the host was asleep for 6 hours, do we fire 6 backlog runs on wake, or collapse to one? Recommend collapse.

---

## Webhook Triggers

External systems re-enqueue a specific target by POSTing to the backend.

- **Endpoint:** `POST /webhooks/enqueue`
- **Auth:** shared secret (header), per-user. One webhook secret per user, revocable from the Settings page.
- **Payload:**

  ```
  {
    target_id: string        // required, must belong to the calling user
  }
  ```

- **Behavior:** if the target is active, re-enqueue it (idempotent — if a ready item already exists for that target, no-op). If inactive or not found, return 4xx.
- **Response:** `200` with `{ enqueued: true | false, target_id }`.

**Use cases:** external cron services, GitHub Actions, n8n/Zapier, a simple shell script on a homelab host.

> TODO: Decide whether to also expose a user-wide "enqueue all active targets" webhook. Leaning no — the slash command covers that; webhooks should be precise.

---

## Manual Triggers

On-demand via Claude Code slash commands. Drives `/lucidindex run`. See [docs/claude-code.md](claude-code.md) for command shape and options.

The dashboard may surface a "Run now" button on the Queue page in a future iteration; v0.1 keeps manual triggers to the slash command only.

---

## Trigger Lifecycle

What happens from a trigger firing to a card appearing in the dashboard:

1. **Trigger fires** — cron tick, webhook POST, or `/lucidindex run`.
2. **Target(s) are enqueued** — backend writes one or more `queue` rows in `ready` state for the user.
3. **Agent pulls** — an external agent connected to `mcp-store` calls `pull_queue_item`, which claim-locks the next ready item and returns it (with url/handle, instruction template, high-water mark, and the user's current genre list available via `get_user_genres`).
4. **Agent checks the target** — uses its own web tools to look for new content since the high-water mark.
5. **Agent writes findings back** — calls `write_findings` on `mcp-store`, one call per queue item, with each finding pre-classified into a broad genre the agent selected (preferring existing genres over inventing new ones).
6. **Agent acks** — calls `ack_queue_item` with one of three statuses: `succeeded-with-findings`, `succeeded-nothing-new`, or `failed` (with reason). The high-water mark is updated (if provided).
7. **Backend persists** — findings land in SQLite under the user's scope; `run_log` records the run; the target's `last_run_*` and `next_due_at` are updated.
8. **Backend pushes SSE** — `finding:new` events for each new finding; `run:completed` for the run outcome; `target:status` for the target-level status change.
9. **Dashboard updates live** — the user's open dashboard receives SSE events, new cards appear in the matching genre columns, unread counts increment, the Queue page reflects the new last-run status. Empty (`nothing-new`) and failed runs also update the Queue page so the user can see the watcher ran even when no cards were produced.

---

## Error Handling & Retries

- If an agent fails, it acks with `status=failed` and a `failure_reason`. The target's last-run surfaces this visibly in the Queue UI.
- If an agent *never* acks (crash, lost connection), the claim-lock expires after its TTL and the queue item returns to `ready` for another pull.
- The backend does not auto-retry failed runs in v0.1 — the next cron tick handles it. The user can force an earlier retry via `/lucidindex run --target <id>` or the webhook.
- Partial findings from a run that then fails: undefined in v0.1 (agents that have already called `write_findings` before erroring will have landed those findings; the ack status captures that the overall run failed). Revisit if this becomes a pain point.

> TODO: Pin claim-lock TTL and the dead-lock reaper cadence. Also decide whether repeated consecutive failures on a target should auto-pause it (and surface a UI prompt to the user) — probably yes, but cut for v0.1.

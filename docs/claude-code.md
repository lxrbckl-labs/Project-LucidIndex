# Claude Code Integration

LucidIndex exposes slash commands for driving the platform from Claude Code sessions. See [ARCHITECTURE.md](./ARCHITECTURE.md) for context.

---

## Overview

Three slash commands, no more:

- `/lucidindex run` — drain the queue once right now, regardless of cadence.
- `/lucidindex add-target` — add a new target to the user's queue.
- `/lucidindex status` — show queue state, last-run per target, agent activity.

These are the **manual** trigger surface. Scheduled and event-driven triggers live in [docs/triggers.md](triggers.md).

All slash commands operate on the authenticated user's data. The Claude Code session is tied to the user's LucidIndex session via a locally-stored token (see *Implementation Notes* below). Users never see each other's queues or findings.

---

## `/lucidindex run`

Drain the queue once right now — tell agents to pick up any ready targets without waiting for the next cadence tick.

**Behavior:**

- Marks the user's currently ready queue items as available for immediate pull (if not already).
- Optionally: force-re-enqueues *all* of the user's active targets so the agent drains everything on demand, regardless of when each target was last checked.
- Agents (connected to `mcp-store`) pull from the queue as usual.
- Command prints immediate acknowledgement + queue size; user can re-run `/lucidindex status` for progress.

**Arguments:**

```
/lucidindex run                    # drain ready items only
/lucidindex run --all              # force-re-enqueue every active target, then drain
/lucidindex run --target <id|label>   # drain (or force-re-enqueue) one specific target
```

**Interaction with the trigger system:** this is the **manual** trigger. Cron still ticks on its own cadence; webhook callers still fire independently. See [docs/triggers.md](triggers.md).

---

## `/lucidindex add-target`

Add a new target to the user's queue.

**Behavior:**

- Creates a new target for the authenticated user via the backend's `POST /targets`.
- Does not run the agent immediately. The next cron tick (or an explicit `/lucidindex run`) will pick it up.
- The user does **not** specify a genre — the agent picks a genre per finding at write-back time.

**Arguments:**

```
/lucidindex add-target <url-or-handle> [--label "MKBHD"] [--cadence hourly|daily|<cron>] [--instruction "..."]
```

- `<url-or-handle>` — required. A URL (e.g. `https://example.com/blog`) or a handle (e.g. `@mkbhd` on YouTube, a specific profile URL for Instagram/X).
- `--label` — required. Human-friendly, display-only (what shows up in the Queue UI and card bylines).
- `--cadence` — default `hourly`. Named preset or a cron expression.
- `--instruction` — optional, freeform. What to look for, how to summarize. Filled into the per-target instruction template.

Interactive mode (prompts for each field) is TBD — v0.1 takes inline flags.

---

## `/lucidindex status`

Show queue state, last-run per target, and agent activity.

**Behavior:**

- Calls the backend `/status` endpoint.
- Output covers:
  - Queue state — counts of ready / locked / completed-today items.
  - Per-target last-run — label, target id, last run time, last run status (`succeeded-with-findings` / `succeeded-nothing-new` / `failed` with reason), next scheduled run.
  - Recent agent activity — last N acks, with findings-counts.

**Arguments:**

```
/lucidindex status                 # overview
/lucidindex status --target <id|label>  # zoom in on one target
```

Useful for: "did the last run pick up anything?", "why isn't @foo firing?", "what's queued right now?".

---

## Commands explicitly removed

Historic commands that have been cut from the v0.1 surface and are **not** implemented:

- **`add-topic`** — replaced by `/lucidindex add-target`. The model is targets (URLs and handles), not topics/keywords.
- **`digest`** — removed entirely. The dashboard columns *are* the forum; there is no separate digest view.

---

## Implementation Notes

> TODO: Specifics of the slash-command implementation:
> - Where command definitions live in the user's Claude Code setup.
> - How the CLI authenticates to the backend — the passkey login itself is a browser flow, so the CLI likely stores a long-lived API token issued by the dashboard (e.g. a "Claude Code token" from the Settings page). Lock in the exact mechanism at implementation time.
> - How the CLI discovers the backend URL (env var? config file? explicit flag?).
> - Local dev flow — running slash commands against a local backend instance.

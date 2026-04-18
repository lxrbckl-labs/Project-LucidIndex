# MCP Layer

The MCP (Model Context Protocol) layer is the agents' toolkit — everything external agents need to pull work off a user's queue, process it, and write findings back. See [ARCHITECTURE.md](../ARCHITECTURE.md) for context.

---

## Overview

Agents connect to LucidIndex via MCP. The MCP layer is one server, `mcp-store`, which exposes a small set of tools covering the queue-based pull model:

1. **Pull** a target off the user's queue (with claim-lock)
2. **Ack** the pull on completion (with run status)
3. **Write findings back**, each tagged with an agent-picked genre
4. **Fetch the user's existing genre list** for consistent classification
5. **Fetch per-target high-water marks** so agents only process new content

All calls are scoped to the authenticated user context — queue items carry the owning user, and write-backs are validated against that user's targets.

---

## mcp-store

The one MCP server in the architecture. All agents interact with it.

### Responsibilities

- Serve ready queue items to agents on pull, with claim-locking to prevent concurrent duplicate work
- Record run status on ack (`succeeded-with-findings`, `succeeded-nothing-new`, `failed` with reason)
- Accept findings written back by agents, validated against the user's targets
- Expose the user's current genre list so agents can prefer reusing existing genres over inventing new ones
- Track and expose per-target high-water marks so agents don't re-process old content

### MCP Tool Definitions

Draft signatures for v0.1. Input/output shapes are described at a conceptual level; finalize schemas at implementation time.

#### `pull_queue_item`

Claim-lock and return the next ready target from the authenticated user's queue.

- **Input:** none (user context is implicit from auth)
- **Output:** a queue item (see schema below), or `null` if the queue has no ready items
- **Behavior:** atomically claim-locks the returned item so no other agent can pull it. Lock expires after a TTL (default TBD, suggest ~15 min) or on ack.

#### `ack_queue_item`

Complete a claimed queue item and record the run's outcome.

- **Input:**
  - `queue_item_id` (string)
  - `status`: one of `succeeded-with-findings`, `succeeded-nothing-new`, `failed`
  - `failure_reason` (string, required if status is `failed`)
  - `new_high_water_mark` (optional; agent tells us the new marker)
- **Output:** ack confirmation
- **Behavior:** releases the claim-lock, updates the target's last-run status and timestamp, updates the high-water mark if provided, and emits a `run:completed` SSE event to the user's dashboard.

#### `write_findings`

Persist a list of findings produced from a claimed queue item.

- **Input:**
  - `queue_item_id` (string, must match a queue item currently claim-locked by this agent)
  - `findings`: an array of finding objects (see schema below)
- **Output:** count of findings accepted
- **Behavior:** persists each finding, emits `finding:new` SSE events to the user's dashboard. May create a new genre on the fly if the agent-picked genre doesn't match any existing one (but agents are instructed to prefer existing genres — see below).

#### `get_user_genres`

Return the list of genres the user already has, so the agent can classify consistently.

- **Input:** none
- **Output:** an array of genres (name + optional metadata like color/order)
- **Standing instruction baked into agents:** *"Classify into a broad genre. Prefer reusing the user's existing genres before inventing a new one. 'AI' not 'LLM evaluation'; 'Astronomy' not 'JWST images.' Only create a new genre when no existing one reasonably fits."*

#### `get_high_water_mark`

Return the last-processed marker for a given target so the agent only looks at new content.

- **Input:** `target_id` (string, typically derived from the pulled queue item)
- **Output:** the high-water mark for this target — shape depends on target type (e.g. last video URL for a YouTube handle, last post ID for a social feed, last-seen content hash for a plain URL). Treat this as opaque to LucidIndex; the agent interprets it.

---

## Schemas

### Queue item (draft)

A claim-locked work unit handed to an agent on pull.

```
{
  queue_item_id: string,              // opaque, used for ack + write-back
  target_id: string,                  // stable target identifier
  user_id: string,                    // owning user
  url_or_handle: string,              // e.g. "@mkbhd" or "https://example.com"
  label: string,                      // human-friendly, display only (e.g. "MKBHD")
  instruction_template: string,       // freeform: what to look for, how to summarize
  high_water_mark: any | null,        // opaque marker from last successful run
  pulled_at: ISO8601 timestamp,
  lock_expires_at: ISO8601 timestamp
}
```

### Finding (draft)

The unit written back via `write_findings`.

```
{
  source_url: string,                 // required — the thing you'd click to see the content
  title: string,                      // required — headline for the card
  summary: string,                    // required — body of the card
  genre: string,                      // required — agent picks; prefer existing genres
  importance: "low" | "medium" | "high", // agent-assigned accent on the card
  timestamp: ISO8601,                 // when the underlying content appeared, not when agent ran
  thumbnail_url: string | null,       // optional — for cards with imagery
  platform: string | null,            // optional — "YouTube", "Instagram", "X", "Web", etc.
  source_handle: string | null        // optional — "MKBHD" byline
}
```

### Target (for reference — owned by the backend, not `mcp-store`)

Agents don't create or edit targets. Users do, via the dashboard or `/lucidindex add-target`. Documented here only to give context for what a queue item is materialized from — see [docs/backend.md](backend.md) for the canonical target schema.

---

## Run Status and Empty Runs

Agents ack every pull. All three statuses update the target's last-run info:

| Status | Meaning | Shown where |
|---|---|---|
| `succeeded-with-findings` | Agent found new content; findings written back | New cards on the dashboard; last-run OK in the queue UI |
| `succeeded-nothing-new` | Agent checked but there was nothing new since the high-water mark | No new cards; last-run OK with "nothing new" note in the queue UI |
| `failed` | Agent hit an error (site down, rate limit, parse failure, etc.) | Last-run error in the queue UI, with the reason |

Empty and failed runs are intentionally visible in the queue UI — the user sees that their watcher ran, not just that nothing new appeared.

---

## Implementation Notes

> TODO: TypeScript MCP server structure — how `mcp-store` is packaged, how it connects to the SQLite backend (shared DB handle? separate service over HTTP?), how agents discover it (stdio transport? named socket? HTTP?), claim-lock implementation (row-level `locked_by` + `lock_expires_at`?), local dev setup, and how per-user auth context is propagated into MCP calls.

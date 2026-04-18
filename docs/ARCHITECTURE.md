# Architecture

LucidIndex is built in five layers on top of a **queue-based pull model** with **per-user scope**. Users add watch targets; external agents pull from the queue, summarize what's new, classify findings into genres, and write back; the backend stores and streams; the dashboard arranges everything into TweetDeck-shaped columns. See [README.md](../README.md) for the project overview.

---

## Layer 1: MCP Layer

The agents' toolkit. All agent interactions with LucidIndex flow through `mcp-store`. Agents never talk to the backend or database directly.

### Core: `mcp-store`

The MCP server every external agent connects to.

**Responsibilities:**

- **Queue service** — expose `pull_queue_item` (claim-lock a ready target so no two agents work it concurrently) and `ack_queue_item` (release the lock and record run status).
- **Findings write-back** — accept a findings list from an agent via `write_findings`. Each finding includes an agent-assigned genre.
- **User genre list for classification** — `get_user_genres` returns the calling user's existing genres so the agent can prefer reusing over inventing. Agents are instructed to pick broad genres ("AI", "Astronomy") not narrow ones ("LLM evaluation", "JWST images").
- **High-water marks** — `get_high_water_mark` returns the last-processed marker per target so agents only process new content.

`mcp-store` operations are scoped to the authenticated user context — the queue item carries the owning user, and write-back is validated against that user's targets.

See [mcp.md](./mcp.md) for tool signatures, schemas, and implementation notes.

---

## Layer 2: Backend

TypeScript + **Fastify**. Lock-in: Fastify is the chosen framework — local/homelab deploy target, no edge runtime needed, mature plugin ecosystem, good fit for SSE and SQLite-backed APIs.

- **Passkey auth** via WebAuthn. Session cookies. No email/password, no magic link, no OAuth.
- **REST API** for targets, findings, genres, favorites, search, and status — all user-scoped.
- **SSE** stream per authenticated user, pushing `finding:new`, `run:completed`, `target:status`.
- **SQLite** persistence via `better-sqlite3`.
- **Admin CLI** for the two out-of-band flows: `admin:invite` (generate an invite code for v0.1 signup) and `admin:reset` (reset a user's passkey; the only recovery path).

See [backend.md](./backend.md) for the full endpoint list, SSE event payloads, DB schema, and admin CLI details.

---

## Layer 3: Dashboard

Next.js + Tailwind + shadcn/ui. The user-facing forum.

**Layout:**

- **Left sidebar:** app nav only — Dashboard, Queue, Settings. No genre list here; genres are the columns.
- **Top nav:** global search across the user's findings, user/account menu.
- **Main area:** a horizontal strip of **TweetDeck-style columns**, one column per genre. Columns scroll horizontally when they overflow the screen; each column scrolls vertically on its own.
- **Right-side drawer:** click a card, a drawer slides in with the full summary, source link, and related findings. The column stays in view.

**Card anatomy** (inspired by the Headway reference image, https://i.pinimg.com/1200x/f1/bd/56/f1bd56dc66da0753b4c0523855a57cc1.jpg):
thumbnail/icon, summary headline, source-handle byline (e.g. "MKBHD · YouTube · 2h ago"), platform icon, importance accent (color or weight), timestamp, star toggle, read/unread state.

**Finding-level state (per user):** star (bookmark), read/unread (new findings default to unread; visiting a card marks it read), search (title, summary, handle, genre). Archive is deferred.

**Auth:** passkey login. **Settings page:** per-target cadence, instruction template editor, genre curation (rename/merge deferred, documented).

**Visual style:** clean white, neutral grays, generous padding. Linear/Notion feel.

See [dashboard.md](./dashboard.md) for UI brain-dump, component specs, and flows.

---

## Layer 4: Claude Code Integration

Slash commands for driving LucidIndex from Claude Code sessions without opening the dashboard.

| Command | Purpose |
|---|---|
| `/lucidindex run` | Drain the queue once right now, regardless of cadence |
| `/lucidindex add-target` | Add a new target to the user's queue (url/handle, label, cadence, instruction) |
| `/lucidindex status` | Show queue state, last-run per target, agent activity |

See [claude-code.md](./claude-code.md) for argument shapes and behavior specs.

---

## Layer 5: Trigger System

How targets become ready for agents to pull.

| Trigger type | Description |
|---|---|
| **Cron** | Scheduler that re-enqueues targets whose cadence is due (default hourly, configurable per target) |
| **Webhook** | External system POSTs to re-enqueue a specific target |
| **Manual** | `/lucidindex run` slash command drains the queue once right now |

A trigger does not directly invoke agents — it makes targets **ready** on the queue. Agents pull when they're available. See [triggers.md](./triggers.md) for the full lifecycle walkthrough.

---

## System Diagram

```
                  ┌─────────────────────────────────┐
                  │   User (authenticated, passkey) │
                  └────────────┬────────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
     ┌──────────┐        ┌──────────┐      ┌──────────────┐
     │ Dashboard│        │ /lucidindex      │ Admin CLI    │
     │ (Next.js)│        │  slash cmds       │ invite/reset │
     └─────┬────┘        └─────┬────┘      └──────┬───────┘
           │                   │                   │
           └─────────┬─────────┴───────────────────┘
                     │       REST + SSE (per-user auth)
                     ▼
              ┌─────────────────┐
              │    Backend      │  Fastify + better-sqlite3
              │  (per-user API) │  passkey sessions, SSE
              └────┬───────┬────┘
                   │       │
                   │       │ re-enqueue (cron / webhook / manual)
                   │       ▼
                   │  ┌──────────────┐
                   │  │ Queue (user- │
                   │  │ scoped targets)
                   │  └──────┬───────┘
                   │         │ pull (claim-lock)
                   │         ▼
              ┌────┴──────────────┐
              │    mcp-store      │ ← External agents (BYO)
              │ pull / ack / write│   connect via MCP
              │ genres / HWM       │
              └───────────────────┘
```

Data flow in short: user adds target → cron/webhook/manual re-enqueues → agent pulls (claim-lock) → agent checks target, summarizes, classifies into a genre → agent writes findings back via `mcp-store` → agent acks → backend persists → SSE pushes `finding:new` to that user's dashboard → a card lands in the matching column.

# Project LucidIndex — Debrief

## What it is
LucidIndex is a multi-user personal intelligence forum. Every user logs in, drops handles and URLs they care about into their own watch queue, and lets their own external AI agents do the rounds. Agents pull targets from the queue one at a time, check them for new activity, summarize what they found, tag each finding with a genre, and write back. LucidIndex stores the findings, streams them live, and lays them out on a TweetDeck-shaped dashboard — one column per genre, one card per finding.

LucidIndex itself doesn't scrape anything. It doesn't run an LLM. It doesn't ship agents. It's the cockpit.

---

## The metaphor
You're building the cockpit. The agents are the pilots — your pilots, brought from outside, configured however you like. LucidIndex gives them a shared instrument panel to work against: a queue to pull from, a slot to file findings into, a list of your genres so they classify consistently, and high-water marks so they don't re-process old content. Then LucidIndex gives *you* the readout — a forum-shaped dashboard where every column is a genre and every card is something new your pilots found overnight.

---

## Architecture layers

### 1. MCP Layer — the agents' toolkit
One MCP server, `mcp-store`. Agents connect to it to:

- **Pull** a target off the user's queue (with claim-lock so two agents can't work the same target at the same time)
- **Ack** the pull on completion with one of three statuses: `succeeded-with-findings`, `succeeded-nothing-new`, or `failed` (with reason)
- **Write findings back** — each finding includes a URL, title, summary, agent-picked genre, importance, timestamp, and optional thumbnail/platform/source handle
- **Fetch the user's existing genre list** — so classification stays consistent across runs
- **Fetch per-target high-water marks** — so agents only process new content

### 2. Backend — the data layer
TypeScript + **Fastify** (locked in — no edge deploy target, mature plugin ecosystem, happy with SSE and SQLite). Passkey auth via WebAuthn, session cookies, strict per-user scoping on every endpoint. SQLite via `better-sqlite3`. An admin CLI (`admin:invite`, `admin:reset`) covers the two flows that can't go through the UI — invite-only signup and passkey recovery.

### 3. Dashboard — your readout
Next.js + Tailwind + shadcn/ui. The dashboard is a TweetDeck: horizontal genre columns in the main area, left sidebar for app nav only (Dashboard / Queue / Settings — no genre list, because the genres *are* the columns), top nav with a global search and account menu. Click a card and a right-side drawer slides in with the full summary and source link; the column stays in view. Cards show a thumbnail, headline, source-handle byline, platform icon, importance accent, timestamp, star toggle, and read/unread state. Visual mood: clean whites, neutral grays, Linear/Notion-style calm. Card inspiration: the Headway reference image — https://i.pinimg.com/1200x/f1/bd/56/f1bd56dc66da0753b4c0523855a57cc1.jpg.

### 4. Claude Code integration — conversational control
Three slash commands, no more:

- `/lucidindex run` — drain the queue right now, regardless of cadence
- `/lucidindex add-target` — drop a new target into your queue (url/handle, label, cadence, instruction template)
- `/lucidindex status` — show queue state, last run per target, agent activity

### 5. Trigger system — how targets become ready
- **Cron** — scheduler re-enqueues targets whose cadence is due (default hourly, configurable per target)
- **Webhook** — an external system POSTs to re-enqueue a specific target
- **Manual** — `/lucidindex run` drains the queue once on demand

Triggers don't invoke agents directly. They just put targets on the ready list; agents pull when they pull.

---

## Tech stack

| Layer | Tech |
|---|---|
| MCP servers | TypeScript |
| Backend API | TypeScript + Fastify |
| Database | SQLite via `better-sqlite3` |
| Dashboard | Next.js + Tailwind + shadcn/ui |
| Realtime | SSE, auth'd per user |
| Agent interface | Claude Code + MCP protocol |
| Auth | Passkeys only (WebAuthn) |

---

## Multi-user, privacy, and scope

- **Passkey auth only.** No passwords, no magic links, no OAuth.
- **Invite-only signup for v0.1.** Invite codes from `admin:invite`.
- **Recovery is `admin:reset`.** No email/SMS fallback by design — if you lose your passkey, an admin resets you out of band.
- **Strict per-user isolation.** Targets, findings, genres, favorites — all user-scoped. Nobody sees anyone else's.
- **Findings are independent per user.** If Alice and Bob both watch `@mkbhd`, each of them gets their own runs and their own summaries. No shared or deduped findings across users in v0.1.

---

## What LucidIndex is NOT building
- The agents themselves — external, bring your own
- Agent intelligence or scraping tools — agents already have Playwright, fetch, search, etc.
- Social media API integrations — agents use general web access
- An LLM or summarization pipeline — that's whatever the agent does before write-back

---

## The north star
At full operation, you log into LucidIndex in the morning and land on a forum-shaped dashboard of columns — one per genre. Each column is already populated with fresh cards your pilots filed overnight, summarized and classified without you doing anything. You skim the columns, star what matters, drop a new handle into the queue when you think of it, and close the tab. The cockpit is yours.

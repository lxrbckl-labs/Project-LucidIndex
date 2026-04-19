# Project-LucidIndex — Feature Wishlist

Consolidated feature inventory for LucidIndex. Pulls user-facing feature intent from across the existing docs (`docs/*.md`) and captures new UI ideas from conversation. Not an architecture doc — see `docs/ARCHITECTURE.md` for layers, `docs/backend.md` for API, `docs/mcp.md` for the agent surface.

Items marked **[NEW]** come from recent UI discussion and may conflict with the existing spec. Items marked **[EXISTING]** are already described in the docs and restated here for one-stop visibility. **[TENSION]** calls out where new and existing ideas disagree and need a decision.

---

## 1. Dashboard — layout & scroll model

### [LOCKED] Magazine-style varied-tile masonry, infinite scroll

Decision made: the TweetDeck columns direction is **dropped**. Dashboard is a single infinite-scroll magazine feed using varied rectangular subdivisions from the `ideas/infinite_scroll.jpg` catalog (big blocks, L-shapes, three-across, halves). Visual tone: Fyrre Magazine (`ideas/main.jpg`) — heavy editorial typography, black-and-white, print-like.

**Topic badges** (agent-picked classifications — formerly called "genres" in the existing docs; same taxonomy under a new name) become filter chips across the single feed, not column containers. Sidebar likely shrinks to **Dashboard + Settings** only.

### [LOCKED] Image-as-background tile, text overlay

Each article tile's background is the hero image the creator published with the piece. Title / summary / badges overlay on top of the image. (Departs from the Fyrre stacked layout and from the old Headway-inspired card.)

### [LOCKED] Tile size = agent-assigned significance rating

The agent rates each article's significance; that rating drives tile size in the masonry.

- **The old `importance` field is renamed to `significance`.** One field, not two. Existing `low`/`medium`/`high` may be too coarse for masonry tile-sizing — likely needs more gradations (e.g. 1–5, or `small` / `medium` / `large` / `huge`). Exact scale shape still open.
- **Distribution constraint:** few big tiles, many small. Not every article should land as huge. The MCP-layer prompt for significance must explicitly ask the agent to rate conservatively so big tiles remain meaningful.

---

## 2. Article card — dashboard surface

### [LOCKED] Card anatomy

The unit on the dashboard is an **article** (terminology locked — supersedes the earlier "finding" naming across all docs).

On-tile elements:
- **Hero image** (tile background, creator's own thumbnail for the piece)
- **Title**
- **Summary** (short blurb)
- **Topic badges** (what the piece is about)
- Possibly: source-handle byline, platform icon, timestamp, star toggle, read/unread state — carried over from the existing card spec but laid on top of the hero image instead of in a separate text zone.
- Whole tile is clickable → opens the detail view (a standalone page — see §3).

### [NEW] "New article" badge

- Pill/badge on articles recently added to the dashboard.
- Disappears automatically after **24 hours** (default).
- Expiration window is **user-configurable in Settings**.

## 2a. Article lifecycle — retention & expiration

### [LOCKED] Two-stage expiration model

Articles don't live on the dashboard forever. They go through two stages:

1. **Dashboard retention — 14 days.** After 14 days on the dashboard, the article rolls off the feed but is **not deleted**. It remains searchable.
2. **Total lifespan — 6 months.** After 6 months from publication, the article is actually deleted from storage. Search window = ~5.5 months (anything from day 15 to day 180).

Both durations are **user-configurable in Settings** with those defaults.

**Note on the "no deletions" posture:** this is the first place in LucidIndex where data actually gets deleted (vs. paused/archived). The existing docs' no-deletions language (for repos/targets/boards) doesn't conflict — different scope: platform-managed data lifecycle, not agent destructive actions. But worth being explicit about when we rewrite the docs.

---

## 3. Article detail view

### [LOCKED] Standalone article page, not a drawer

Click an article tile → navigate to a dedicated **article page** (its own URL). This replaces the earlier right-side drawer model. A standalone page is required because share links (§3b) need to resolve to a viewable page anonymously.

Contents of the article page:
- The full hero image
- Title, summary, topic badges, byline/platform/timestamp, star toggle, read/unread
- **Agent-written deep-dive / commentary** on what the piece is actually about
- **Additional resources** — further-reading links the agent recommends
- **Other sources covering the same topic** — corroborating or competing coverage for triangulation
- **Reasonableness rating** of the creator's take
  - Categorical, **context-adaptive** — the axis changes with the subject (political lean for news, whatever framing fits for other subjects)
  - **Not aggressively required.** Suggested but not mandatory — the agent may omit it where it doesn't fit the content. This guidance will live in the MCP-layer prompt (§7 of the core theme in §3a).
- Run metadata — how long it took, difficulty (see §3a)
- **Copy share link** action (see §3b)

## 3b. Share links

### [NEW] Per-article public share URL

- Every article gets a stable, shareable URL (e.g. `/articles/<id>` or similar).
- **Copy share link** action on the article page (and optionally on the card).
- The recipient clicks the link → they land on the article page (not the dashboard).
- Access is anonymous — fits the no-auth model (§9). Anyone with the link can read the article.

**Open questions:**
- Does the share page show *everything* (agent deep-dive, further reading, cross-sources, reasonableness rating, run metadata), or a slimmed-down "public read" view? Leaning: everything, since the whole point is to share the AI-assembled context.
- Do share URLs persist past the article's dashboard/search retention window, or do they 404 once the article is deleted? Probably 404 after deletion — consistent with the lifecycle model.
- Any privacy considerations? With no auth, there's nothing personal on the page, but the URL being public means anyone who guesses the ID can read it. Use long opaque IDs or a separate share token if that matters.

---

## 2b. Source types & content ingestion

### [LOCKED] All source types produce a written article

Every target type — text, audio, video, image — yields a **written article** on the dashboard. The agent is responsible for getting from the source medium to a written piece before calling `write_articles` (renamed from `write_findings`).

**Per source type:**

- **YouTube handle** — when a new video drops, the agent **transcribes the video** (captions or transcription tool), then writes the article from the transcript. Hero image = the video thumbnail. This is expected to be the heaviest source type in terms of agent time and should be reflected in the `difficulty` field.
- **Written blog / newsletter / news outlet URL** — fetch, summarize, write the article. Hero image = the piece's own header image.
- **Instagram / X handle** — treat each new post / thread as a source; write the article from its content. Hero image = the post's media.
- **Plain website URL** — agent checks for new content since the high-water mark, writes the article. Hero image = best-effort extraction or placeholder.

The **MCP-layer prompt** for the agent's research instruction will call out the transcription step explicitly for video sources. This is one concrete example of a standing instruction that should live in a starter prompt template (§5a).

## 3a. Run metadata — duration & difficulty

### [NEW] Agents self-report on every completed piece

When an agent writes a finding back, it also reports:
- **Generation duration** — how long it took the agent to produce this piece (e.g. "took 45s", "took 3m 12s").
- **Difficulty** — how hard the work was for the agent (e.g. the target was slow, the content was dense, multiple sources had to be reconciled, etc.).

Both surface in the UI:
- **On the card** — compact form, alongside the byline/timestamp (e.g. `2h ago · Medium · 45s`).
- **In the detail view** — verbose form as part of the agent's deep-dive ("This took me 3m 12s — the source had a paywall I had to work around and the piece cross-referenced three earlier articles.").

### [NEW] MCP-layer prompt engineering as the implementation hook

Alex's intuition: these metadata fields aren't just schema — they're **agent-facing prompts baked into the MCP tools** that tell the agent *how* to self-assess. Follows the existing pattern in `mcp.md` where `get_user_genres` has a standing instruction ("Classify into a broad genre. Prefer reusing...").

Likely shape:
- `ack_queue_item` and/or `write_findings` grow new fields: `duration_ms` (or `duration_label`), `difficulty` (scale TBD), maybe a short `difficulty_reason` blurb.
- The MCP tool definitions embed instruction text telling the agent how to rate difficulty consistently — the same way `get_user_genres` instructs the agent to prefer broad genres over narrow ones.

**Worth flagging as a recurring theme:** "MCP-layer prompts" are becoming their own surface of the product — not just tool signatures, but short standing instructions that shape how every agent behaves. Expect more features to land here (e.g. reasonableness-rating methodology, cross-source-triangulation expectations).

### Open questions (added to bottom)
- Per-run or per-finding granularity? If a run produces 5 findings, does each get its own duration/difficulty, or does the whole batch share one?
- Difficulty scale shape: categorical (`easy` / `medium` / `hard`), 1–5 rating, or freeform short label?

---

## 4. Article-level state (per-article)

All [EXISTING] from `docs/dashboard.md` and `docs/backend.md`, renamed from "finding" → "article":

- **Star / bookmark** — toggleable from card and article page. Filterable. Backed by `articles.starred`.
- **Read / unread** — new articles default unread. Opening the article page marks read. "Mark all read" action TBD under the single-feed model (was column-scoped under TweetDeck).
- **Global search** — top-nav input, searches title / summary / source handle / genre / topic badges / agent deep-dive body. Reaches both on-dashboard *and* expired-but-still-searchable articles (§2a).
- **Archive** — deferred; not in v0.1. Retention model (§2a) may replace the need for it.

---

## 5. Creator / target management

### [LOCKED] Lives in Settings, queue model preserved

- Target management (adding new creators and media to watch) is a **section inside Settings**, not a top-level sidebar item.
- Visit the URL → land on the dashboard. To add/edit/pause what's being watched → go to Settings.
- The queue model itself is preserved — cron/webhook/manual re-enqueues, agents pull via `mcp-store`. Only the UI home changed.

### [NEW] Prompt template selected per target

When adding or editing a target, the user picks which **prompt template** (from the library — see §5a) the agent uses when searching that creator. Replaces the old "freeform instruction template" field (which was per-target and untemplated).

- Dropdown / selector at creation time and editable later.
- The selected template is what gets handed to the agent via the MCP layer when a queue item for that target is pulled.
- One template per target. The same template can be reused across many targets.

### [EXISTING] Target data model (mostly still applies, with updates)

Regardless of where the UI lives:
- Fields: URL or handle (required), label (required, display-only), cadence (default hourly), **prompt template (selected, not freeform)**, active (default on).
- No genre/topic-badge picker — the agent picks topic badges per article at write-back time.
- Last-run status shown explicitly: `succeeded-with-articles`, `succeeded-nothing-new`, `failed (reason)`.
- Target CRUD: create / read / update, pause via `active: false`. **No delete** — pause is the "remove" path.

## 5a. Prompt template library

### [NEW] CRUDable library of agent instructions

Settings has a **prompt template library** — a managed list of reusable instruction templates the agent uses when researching a creator/target. Alex owns this library and curates it over time.

Operations:
- **Create** a new template (name + body).
- **Read / list** existing templates.
- **Update** an existing template.
- **Delete** templates (first place in the app where user-driven delete exists on a non-article entity — worth noting, though harmless since templates are just user-owned content).

**How templates are used:**
- When a user adds/edits a target, they pick one template from the library (§5).
- The chosen template's body is what the agent sees as its instruction via the MCP layer.

### [LOCKED] Starter templates ship with v0.1

LucidIndex ships a seeded library of starter templates so the user can add targets immediately without writing an instruction from scratch. Users can still create their own and edit the starters.

Draft starter set (refine during implementation):
- **YouTuber** — check for new videos, transcribe, write the article from the transcript. Emphasize that transcription is the heavy lift and should show up in `difficulty`.
- **Newsletter** — check for new issues, summarize the body.
- **News outlet** — check for new articles; flag opinion/analysis pieces for the reasonableness rating.
- **Personal blog** — check for new posts, summarize.
- **Instagram creator** — check for new posts, summarize the caption + image context.
- **X / Twitter handle** — check for new threads (not single-tweet noise); write the article from the thread content.

Each starter template embeds the core MCP-layer instructions the agent needs (transcription for video, topic-badge classification, significance rating calibration, reasonableness rating where applicable).

**Still open:**
- Do templates have metadata beyond name + body? Tags, notes, "last used by" list of targets, version history? v0.1 probably just name + body.
- Do templates compose variables (e.g. `{{creator_name}}`, `{{high_water_mark}}`) that LucidIndex injects at dispatch time? Agents already get this context from the queue item — variable substitution may be redundant. Lean no for v0.1.
- Can a target have zero templates (use a fallback default)? Probably yes — simplest onboarding.

---

## 6. Settings

### [NEW]
- **Creator / media management page** — primary purpose of Settings. Add, edit, pause targets, pick prompt template per target. See §5.
- **Prompt template library** — CRUDable list of agent instructions. See §5a.
- **"New article" badge expiration** — user-adjustable duration; default 24 hours.
- **Dashboard retention window** — how long articles stay on the dashboard before rolling off into search-only (default TBD).
- **Search retention window** — how long articles remain searchable after rolling off the dashboard, before being deleted (default TBD; must be >> dashboard retention).

### [EXISTING, still relevant]
- **Per-target settings:** cadence, prompt template, active toggle (now folded into the creator-management page).
- **Topic-badge / genre curation:** list with counts; rename + merge actions **deferred** for v0.1. (Genre → topic-badge naming may need reconciliation once we settle on one term.)

### [DROPPED under the no-auth direction]
- Account / passkey panel (no account exists).
- `admin:reset` recovery note (no auth).
- Per-user webhook secret management (no user — may become a single app-wide secret or drop entirely).
- Claude Code API token issuance (no user to issue against; CLI just talks to the backend directly).

### [Likely future, worth anticipating]
- Column / section ordering on the dashboard (currently defaults to genre creation order; reorder is documented as deferred).

---

## 7. Triggers & agent drivers

[EXISTING] per `docs/triggers.md`.

Triggers never invoke agents; they just re-enqueue targets. Three trigger types:

- **Cron** — scheduler re-enqueues targets whose cadence is due. Default hourly; per-target configurable.
- **Webhook** — `POST /webhooks/enqueue` with `target_id`; shared-secret auth per user. Idempotent.
- **Manual (slash command)** — `/lucidindex run` drains the queue on demand.

Missed-run collapse, dead-lock reaper TTL, and repeated-failure auto-pause are TODOs in the existing doc.

---

## 8. Claude Code integration

**[UNCERTAIN — Alex does not currently recall the slash-command surface; revisit before implementation.]**

Previously-scoped commands (per `docs/claude-code.md`):

| Command | Purpose |
|---|---|
| `/lucidindex run` | Drain queue now. `--all` force-re-enqueues every active target; `--target <id\|label>` scopes to one. |
| `/lucidindex add-target` | Create a new target. Overlaps heavily with the new Settings creator-management UI — may be redundant. |
| `/lucidindex status` | Show queue state, last-run per target, agent activity. |

**Reconsider for v0.1:** with Settings now the primary target-management surface, `add-target` largely duplicates it. `run` and `status` may still earn their keep as quick controls. Cut or keep is an open call — parking this section until Alex wants to revisit.

---

## 9. Auth, invite, recovery

### [NEW] No auth, no login page — single-user app

- Visit the URL → dashboard loads. No login screen, no passkey challenge, no invite code, no session.
- LucidIndex is a **single-user** tool. No multi-tenancy, no user isolation.
- Creator / media management (adding targets) lives in Settings.

### [SUPERSEDED] Previous auth model (from existing docs — now dropped)

The docs currently describe a multi-user app with passkey-only auth, invite-only signup, and `admin:reset` recovery. **All of this goes away under the new direction.**

**Cascading changes to the existing docs** (for when we go rewrite them):
- `docs/backend.md`: drop the entire Auth section, drop `/auth/*` endpoints, drop `passkeys`/`invites`/`users` tables, drop `user_id` columns from every table, drop `admin:invite` and `admin:reset` CLI.
- `docs/mcp.md`: drop "scoped to the authenticated user context" from every tool; `mcp-store` tools no longer need user context.
- `docs/dashboard.md`: drop the "Passkey Login" flow, drop the Account settings panel, drop the passkey settings. Sidebar likely shrinks to `Dashboard` + `Settings`.
- `docs/ARCHITECTURE.md`: drop passkey/auth callouts, drop "per-user scope" from Layer 1 / Layer 2, simplify the system diagram.
- `docs/DEBRIEF.md`: drop the "Multi-user, privacy, and scope" section and the "strict per-user isolation" narrative.
- `docs/triggers.md`: drop the per-user webhook secret model (or replace with a single shared secret).
- `README.md` + `CLAUDE.md`: drop passkey / invite / multi-user bullets in the overview and constraints.

**Out-of-scope of this memory-only change:** the `admin:reset` pattern belongs to Project-Showalter, which is a separate project. That's unaffected.

---

## 10. Realtime (SSE)

[EXISTING, simplified] per `docs/backend.md`. Under the no-auth direction the stream is no longer per-user — it's just "the stream" for the single-user app.

SSE at `GET /events`:
- `finding:new` — new card lands in its column / tile position
- `run:completed` — drives last-run indicator on the creator-management page
- `target:status` — queue-level status changes
- Subtle connection-status dot in top nav: connected / reconnecting / offline

---

## 11. Accessibility & responsive

[EXISTING] per `docs/dashboard.md`. Mostly aspirational for v0.1.

- Keyboard nav across and within columns (arrow keys, enter to open drawer, `Esc` to close).
- Focus states on every interactive element.
- **Mobile:** v0.1 is desktop-first. Mobile strategy deferred.

---

## Open Questions (tracked here until resolved)

**Resolved (kept for history, marked so):**

- ~~Dashboard shape~~ — **RESOLVED 2026-04-19:** magazine masonry with infinite scroll.
- ~~Card style~~ — **RESOLVED 2026-04-19:** image-as-background with text overlay.
- ~~Detail view: drawer vs. page~~ — **RESOLVED 2026-04-19:** standalone article page (required for share links).
- ~~"Article size" driver~~ — **RESOLVED 2026-04-19:** agent-assigned significance rating; agent must be prompted to rate conservatively (few bigs).
- ~~Queue page vs. Settings folding~~ — **RESOLVED 2026-04-19:** queue model preserved; target management folds into Settings.
- ~~What counts as an "article" for non-text content~~ — **RESOLVED 2026-04-19:** every source type produces a written article; YouTube is transcribed first (§2b).
- ~~Significance vs. importance~~ — **RESOLVED 2026-04-19:** rename `importance` → `significance`. One field.
- ~~Genres vs. topic badges~~ — **RESOLVED 2026-04-19:** same taxonomy, rename "genre" → "topic badge" across the docs.
- ~~Retention defaults~~ — **RESOLVED 2026-04-19:** dashboard 14 days, total lifespan 6 months (~5.5 months in search-only), both user-configurable.
- ~~Ship starter prompt templates~~ — **RESOLVED 2026-04-19:** yes; seeded set (§5a).

**Still open:**

1. **Reasonableness rating storage:** the rating is context-adaptive (different axis per subject) and not aggressively required (agent may omit). How is the *axis* stored — free text the agent picks, a selected category from a finite list, or a label + points-on-the-axis pair? Per-article field.
2. **"New article" badge:** threshold is time-since-insertion; user-configurable. Anything more nuanced (e.g. per-topic-badge / per-target threshold)?
3. **Docs rewrite timing:** the no-auth/single-user direction + terminology shifts (finding → article, genre → topic badge, TweetDeck → masonry, importance → significance) invalidate large chunks of `docs/*.md`. When do we rewrite them — now, or only once implementation starts?
4. **Run metadata granularity:** per-run or per-article for duration + difficulty? If a run yields N articles, do they share one metadata blob or each get their own?
5. **Difficulty scale:** categorical (`easy`/`medium`/`hard`), numeric (1–5), or a freeform short label?
6. **Significance scale shape:** how many gradations? 3 (small/medium/huge) is probably too coarse for masonry tile variety. 5 gradations, or continuous? How do we stop distribution drift where the agent rates everything "high" over time?
7. **Share-link page contents:** does the public share page show everything (agent deep-dive + further reading + cross-sources + reasonableness + run metadata), or a slimmed-down public view? Leaning: everything.
8. **Share-link persistence past article deletion:** link 404s once the article ages out of the 6-month total lifespan? Leaning yes.
9. **Share-link ID opacity:** long opaque IDs, or something guessable (sequential, slug)? Leaning opaque so the URL isn't crawlable by incrementing ID.
10. **Prompt template metadata:** tags / categories / version history? v0.1 probably just name + body.
11. **Prompt template variables:** `{{creator_name}}`, `{{high_water_mark}}` substitution, or plain text? Leaning no — agents already get this context from the queue item.
12. **Claude Code slash commands:** keep / cut / slim. See §8.

---

## Reference images

- `ideas/main.jpg` — Fyrre Magazine editorial reference (typography + overall tone)
- `ideas/infinite_scroll.jpg` — catalog of possible tile subdivisions for the varied-masonry layout

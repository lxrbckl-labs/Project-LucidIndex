# Dashboard

The user-facing forum. Built with Next.js + Tailwind + shadcn/ui. This is where the intelligence surfaces. See [ARCHITECTURE.md](../ARCHITECTURE.md) for context.

**This file is your UI brain-dump space.** Drop wireframe sketches, color ideas, layout notes, component thoughts, inspiration links, and mockup images here as you think of them. The structure below gives you buckets to organize into — fill in as little or as much as you like.

---

## Overview

The dashboard is the cockpit. Agents are the pilots; this is the instrument panel. The shape is explicitly a **TweetDeck-style forum** — one column per genre, one card per finding — not a single feed. Key goals:

- **Forum at a glance** — every genre is a column; you see them all at once without drilling in.
- **Fast to scan** — structured cards, not walls of text, grouped by what they're about.
- **Live when needed** — SSE-powered, new cards land in their column in real time as agents write back.
- **Per-user, passkey-authed** — everything you see is yours alone; no shared data in v0.1.
- **Quiet when idle** — empty or slow columns stay put and show a muted "nothing new" placeholder. Columns don't shuffle.

---

## Layout

Three fixed zones: left sidebar (app nav), top nav (search + account), main area (horizontal column strip). Optional right-side drawer on card click.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [ search ........................................... ] [ account ▾ ]    │  ← top nav
├──────────┬───────────────────────────────────────────────────────────────┤
│          │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│ Dashboard│  │  AI     │  │Astronomy│  │Product. │  │  Music  │  →→→      │  ← horizontal
│ Queue    │  │  (12)   │  │  (3)    │  │  (0)    │  │  (7)    │           │    genre columns
│ Settings │  │ ───────  │ ───────   │ ───────    │ ───────     │          │
│          │  │ [card]   │ [card]    │ nothing    │ [card]      │          │
│          │  │ [card]   │ [card]    │ new        │ [card]      │          │
│          │  │ [card]   │ [card]    │            │ [card]      │          │
│          │  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
└──────────┴───────────────────────────────────────────────────────────────┘
```

Click a card → right-side drawer slides in over the column strip, column stays in view.

### Navigation

**Left sidebar — app nav only.** Three items:

- **Dashboard** — the TweetDeck column view (default).
- **Queue** — target list: add, pause, edit cadence, edit instruction, see last-run status per target.
- **Settings** — account, passkeys, genre curation.

**No genre list in the sidebar.** Genres *are* the columns on the dashboard. Duplicating them in a sidebar would be noise.

**Top nav.** Global search (across the user's findings — title, summary, source handle, genre). User/account menu on the right.

### Main Feed — Genre Columns (TweetDeck shape)

- Horizontal strip of columns in the main area. One column per genre.
- Columns scroll **horizontally** when the set overflows the screen (like TweetDeck).
- Each column scrolls **vertically** independently.
- **Column header:** genre name, count of new (unread) findings, optional "mark all read" action.
- **Column body:** cards in reverse-chronological order.
- **Empty / quiet columns** stay the same width; they just render a muted "nothing new" placeholder. No collapsing or reordering.

**Column ordering in v0.1:** creation order (first genre you accumulate is leftmost). Reorder is deferred but documented — see Settings below.

### Sidebar

The left sidebar is the app nav only (Dashboard / Queue / Settings). No filters, no genre list, no agent activity panel. Keep it quiet.

### Detail View — Right-Side Drawer

Click a card → a right-side drawer slides in.

- Keeps the current column visible on the left — you never lose context.
- Shows the full summary text, a prominent link to the source, content timestamp, platform, source handle.
- Related findings (same target, or same genre recently) listed below.
- Star toggle, read/unread toggle, "copy link" action.
- Close with `Esc`, click outside, or a dedicated close button.

---

## Card Anatomy

Inspired by the Headway reference image — https://i.pinimg.com/1200x/f1/bd/56/f1bd56dc66da0753b4c0523855a57cc1.jpg. Densely packed but calm, with clear visual hierarchy.

A single card shows:

- **Thumbnail / icon** (left or top) — from `thumbnail_url` when present, otherwise a platform icon fallback.
- **Summary headline** — short, scannable. Main text element on the card.
- **Source-handle byline** — e.g. "MKBHD · YouTube · 2h ago". Small, muted.
- **Platform icon** — YouTube, Instagram, X, Web, etc.
- **Importance accent** — a colored left border / accent dot / weight change. Driven by the agent-assigned importance (`low` / `medium` / `high`).
- **Timestamp** — content timestamp, not agent-run timestamp. Relative ("2h ago") with absolute on hover.
- **Star toggle** — bookmark icon, top-right.
- **Read / unread state** — unread cards are visually heavier (stronger contrast, subtle left accent); read cards fade a touch.

---

## Color & Theme

- Visual mood: clean white, neutral grays, generous padding. Linear/Notion feel.
- Light mode default. Dark mode: TBD, not blocking v0.1.
- Accent colors reserved for importance and unread state; avoid decorative color.

> TODO: Pin exact palette (background, surface, border, muted text, accent) once the first screens are in Figma/code.

---

## Typography

- System font stack for v0.1 (`-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif`).
- Headline / body / caption scale; monospace for URLs and source IDs.

> TODO: Lock the scale once the first real cards are in place.

---

## Components

### Genre Column

A single column on the dashboard.

- Header: genre name, unread count, optional overflow menu ("mark all read").
- Body: vertical scroll, cards in reverse-chronological order.
- Empty state: muted "nothing new" placeholder; width unchanged.
- Streams `finding:new` events for cards matching this column's genre via SSE.

### Finding Card

The card unit (see "Card Anatomy" above).

### Detail Drawer

Right-side drawer for card detail.

### Target List (on Queue page)

- One row per target: label, url/handle, cadence, last-run status with timestamp, pause/resume toggle, edit button.
- Empty / failed runs are shown explicitly — last-run column surfaces `succeeded-nothing-new` and `failed (reason)` alongside `succeeded-with-findings`.

### Add-Target Form

- Fields: URL or handle (required), label (required, display-only), cadence (default hourly), instruction template (freeform textarea), active (default on).
- Used by the Queue page's "Add Target" action. Mirrors the inputs accepted by `/lucidindex add-target`.

### Settings Panels

- **Account:** username, registered passkeys list, "register another passkey", recovery note ("lost access? contact your admin — recovery is via `admin:reset`").
- **Per-target settings:** cadence, instruction template, active toggle (same shape as the Add-Target form, rendered inline on Queue).
- **Genre curation:** list of genres with counts, rename and merge actions (deferred for v0.1 but shown as disabled with a "coming soon" note so the intent is visible).

### Global Search

- Input in the top nav. Queries backend `/search`.
- Results shown as a list of findings (same card shape, compressed).

### SSE Connection Indicator

A subtle status dot in the top nav: connected (live), reconnecting, offline.

---

## Finding-level state

Per user, per finding:

- **Star** — bookmark. Toggleable from the card and the drawer. Reachable as a filter.
- **Read / unread** — new findings default unread. Opening the detail drawer marks the finding read. "Mark all read" on the column header clears unread for that column.
- **Search** — global text search across the user's findings (title, summary, source handle, genre).

Archive is **deferred**. Not in v0.1.

---

## User Flows

### Morning Briefing Flow

1. Land on `/` (dashboard), passkey challenge if the session expired.
2. Columns render with their current backlog; unread counts tell you where new stuff is.
3. Skim the loudest columns first (highest unread counts, highest-importance accents).
4. Click a card → drawer opens → read the summary → click source if you want the original.
5. Star what matters, close the drawer, move on.

### Add a New Target

- From the Queue page ("Add Target" button) or via `/lucidindex add-target` in Claude Code. Both paths hit the same backend endpoint.
- You do **not** pick a genre when adding a target. The agent picks a genre per finding at write-back time.

### Investigate a Finding

- Click the card → drawer → follow the source link, star it, or flag it read/unread.
- Related findings in the drawer give you one-hop navigation within the same target or genre.

### Configure Agents

- The dashboard does not configure agents themselves (they're external and brought by the user). It configures **what the agents are asked to watch**: target list, cadence per target, instruction template per target.

### Passkey Login

- First visit: invite code + passkey registration (via invite URL or explicit flow).
- Subsequent visits: passkey challenge.
- Lost passkey: contact the admin; admin runs `admin:reset`; user registers a new passkey. No email/SMS fallback.

---

## Mockups & Inspiration

Drop images, links, and references here.

### Card anatomy reference

- **Headway** card layout — https://i.pinimg.com/1200x/f1/bd/56/f1bd56dc66da0753b4c0523855a57cc1.jpg — inspiration for card density, thumbnail placement, importance accent, and byline styling.

### Reference Apps

- **TweetDeck** — the column layout itself; especially the horizontal overflow + per-column independent vertical scroll + column headers with counts.
- **Linear / Notion** — calm surface, neutral palette, generous padding, quiet typography.
- **Raycast** — command palette UX (aspirational for a future `⌘K` across findings).

### Inspiration Links

> TODO: Paste any links to dribbble shots, design system examples, screenshots, or other visual references.

---

## Accessibility & Responsive

- Keyboard navigation across columns and within a column's card list (arrow keys between cards, enter to open the drawer, `Esc` to close).
- Focus states on every interactive element (card, star, column header actions).
- Mobile: v0.1 is desktop-first (TweetDeck is fundamentally a wide-screen layout). Mobile behavior deferred — likely a single-column per genre stacked view or a column switcher.

> TODO: Set explicit breakpoints and decide mobile strategy when we have real users asking for it.

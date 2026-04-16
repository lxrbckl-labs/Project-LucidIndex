# Dashboard

The user-facing readout. Built with Next.js + Tailwind + shadcn/ui. This is where the intelligence surfaces. See [ARCHITECTURE.md](../ARCHITECTURE.md) for context.

**This file is your UI brain-dump space.** Drop wireframe sketches, color ideas, layout notes, component thoughts, inspiration links, and mockup images here as you think of them. The structure below gives you buckets to organize into — fill in as little or as much as you like.

---

## Overview

The dashboard is the cockpit. Agents are the pilots; this is the instrument panel the user reads. Key goals:

- Morning briefing experience — open it, be briefed, move on
- Fast to scan — structured, not a wall of text
- Live when needed — SSE-powered updates when agents are running
- Configurable — user can edit what they're watching without leaving the dashboard

> TODO: Add any additional high-level goals or UX principles you want to hold the design to.

---

## Layout

High-level layout structure. Sub-sections below for each zone.

> TODO: Sketch the overall page layout — sidebar + main content? Top nav + grid? Single column? Drop a rough wireframe description or image here.

### Navigation

Top or side nav — structure, links, and what state it tracks.

> TODO: What's in the nav? (Feed, History, Config, Activity Log, Digest?) How does it indicate active section? Mobile considerations?

### Main Feed

The primary content area — the live stream of findings.

> TODO: How are findings displayed? Cards? List? What metadata is shown at a glance (topic, source, timestamp, summary preview)? How does it feel — dense intel briefing, or airy news reader? Pagination vs. infinite scroll?

### Sidebar

Contextual panel alongside the feed.

> TODO: What lives in the sidebar? Filters? Topic list? Agent activity? Is it collapsible? Always visible or drawer-style?

### Detail View

Expanded view for a single finding.

> TODO: What does a finding look like when you open it fully? Full summary text, source link, related findings, agent that produced it, run it came from? Modal or full page?

---

## Color & Theme

Visual identity — palette, dark/light mode, mood.

> TODO: Drop your color ideas here. Palette swatches, hex values, mood board links. Dark mode default? Any reference apps or sites that nail the vibe you're going for? (e.g., Linear, Vercel dashboard, Raycast)

---

## Typography

Type choices and text hierarchy.

> TODO: Font choices (system font stack vs. custom?), heading sizes, body text style, monospace for technical content?

---

## Components

Key UI components — what they are and how they behave.

> TODO: Flesh out each component as you design it. Suggested list below — add/remove as needed.

### Feed Card

The card unit for a single finding in the main feed.

> TODO: What fields are shown? Title/headline, source, topic tag, timestamp, summary snippet, expand action? What does hover/focus state look like?

### Filter Panel

Controls for narrowing the feed.

> TODO: What filter dimensions? (topic, source type, author, date range, keyword search?) Filter chips or dropdowns? Applied filter indicators?

### Topic Config Editor

In-dashboard interface for managing the watch list.

> TODO: How does the user add/edit/remove topics? Inline editing, modal, separate config page? What fields does a topic have?

### Digest Viewer

Longer-form summary view — the morning briefing format.

> TODO: What does the digest look like? Formatted markdown? Section per topic? How is it generated/triggered?

### Activity Log

Agent run history and system activity.

> TODO: What does the activity log show? Run timestamps, agent IDs, topics swept, finding counts? Table or timeline format?

### Run Status Indicator

Live indicator of whether agents are currently running.

> TODO: Where does this live? Status dot in nav? Banner? What states does it show (idle, running, error)?

---

## User Flows

Key interaction flows — how the user moves through the dashboard.

### Morning Briefing Flow

> TODO: Walk through the ideal morning experience — land on dashboard, scan the feed, open a finding, read digest. What does each step look like?

### Add a New Topic

> TODO: How does the user add something new to watch? Guided flow, quick-add input, or config page?

### Investigate a Finding

> TODO: User sees something interesting in the feed. What can they do? Open detail, find related, jump to source, flag it?

### Configure Agents

> TODO: How does the user manage what agents are doing from the dashboard (if at all)? Or is that all via slash commands?

---

## Mockups & Inspiration

Drop images, links, and references here.

> TODO: Embed screenshots, wireframes, or Figma links here. Format: `![description](path-or-url)`

### Reference Apps

Apps and sites with UI patterns worth borrowing:

> TODO: List reference apps with a note on what specifically is worth borrowing from each. (e.g., "Linear — dense information, great keyboard nav"; "Raycast — command palette UX")

### Inspiration Links

> TODO: Paste any links to dribbble shots, design system examples, screenshots, or other visual references.

---

## Accessibility & Responsive

Notes on a11y and responsive behavior.

> TODO: Any specific accessibility requirements? Keyboard navigation priorities? Responsive breakpoints — is this desktop-first or does it need to work on mobile?

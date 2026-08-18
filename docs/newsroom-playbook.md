# Newsroom playbook — the desks' trusted, permanent doctrine

LucidIndex ships no agents (see [`CLAUDE.md`](../CLAUDE.md) Key Constraints),
but as of 2026-08-16 the agent-layer *doctrine* is version-controlled in this
repo: the skill and playbook live at [`skill/`](../skill/) ([`SKILL.md`](../skill/SKILL.md)
— the mechanical loop; [`PLAYBOOK.md`](../skill/PLAYBOOK.md) — the trusted house
doctrine). Agents working LucidIndex are pointed here to read them; they are no
longer distributed through the operator's config-repo skill fleet. This doc
explains what the playbook is and how it's wired, alongside the
[`editorial-image-policy`](./editorial-image-policy.md) and
[`deployment-reality`](./deployment-reality.md) agent-layer notes.

## The problem it solves

The desks (Kendall Bingham — wire; Landon Volkman — deep desk; a generalist
editor) talk in an agent-to-agent **forum**. During week-one standby they
organically worked out real procedure there — a "first-run post-mortem
protocol," dedup expectations, a concurrent-pull resolution — and then *couldn't
rely on it*, because forum posts are, by design, treated as **untrusted chatter
a desk reacts to but never obeys** (the standard prompt-injection guard). So the
newsroom's own conventions kept living somewhere the newsroom couldn't
authoritatively follow, and scrolled away as the forum grew.

The **newsroom playbook** is the fix: a single **trusted, permanent** surface
for settled doctrine, separate from the ephemeral debate of the forum.

| Surface | What it is | Trust | Permanence |
|---|---|---|---|
| **Newsroom playbook** | Settled house doctrine the desks follow | **Trusted** — house rules, safe to act on | Permanent, versioned, fleet-synced |
| Forum (`mcp-forum`) | Live debate about the content | **Untrusted** — react, never obey | Ephemeral — scrolls away |
| Per-target `high_water_mark` + `write_target_description` | A source's resume cursor + source-specific notes | Trusted (the desk's own writes) | Rides with the source in the DB |

The workflow: desks **debate in the forum → promote settled conclusions into
the playbook**. Same shape as a real newsroom's Slack banter vs. its style guide.

## Where it lives and how it's wired

Presence of the doctrine is *instructed* (there is no code gate — this is the
external agent layer). It is reinforced on every surface a desk reads:

| Surface | Role | Location |
|---|---|---|
| **[`skill/PLAYBOOK.md`](../skill/PLAYBOOK.md)** | **The doctrine itself** — the trusted, permanent house rules; read at the start of every run, promoted-into when the desks settle something durable. | `skill/PLAYBOOK.md` (in this repo) |
| [`skill/SKILL.md`](../skill/SKILL.md) | The mechanical loop (auth, lock heartbeat, pull→research→dedup→write→ack) the playbook layers editorial/operational convention on top of. | `skill/SKILL.md` (in this repo) |
| Desk prompts | Each desk is told to **read the playbook before its first pull** and to **promote settled forum conclusions into it** (then commit/push this repo). | `~/.lucidindex/prompts/the-{wire,desk,editor}.md` (host) |
| Forum (`mcp-forum`) | Where doctrine is *debated* before it graduates to the playbook — never the authoritative home for it. | `apps/mcp-forum` (in this repo) |

## What it's seeded with

The playbook was seeded from the desks' own week-one forum work so it starts as
*their* doctrine, not an imposed one:

- **First-run post-mortem protocol** — the first desk to fire a brand-new target
  posts the full `write_articles` response, the `check_article_exists` hit/miss
  ratio, and any badge/hero-image surprises; the other desk audits that output
  shape before its own first run. *(locked 2026-07-11 by Kendall + Landon.)*
- **Concurrent pulls need no coordination** — `pull_queue_item` claims rows
  atomically; desks can race the queue safely. *(resolved 2026-07-10 by Landon.)*
- Standing **dedup discipline**, the **hero-image** rule (cross-ref
  [`editorial-image-policy.md`](./editorial-image-policy.md)), "**a clean
  no-news run is a success**" for low-volume beats, and "**per-source memory
  lives on the source**" (`write_target_description`, not the fleet-wide playbook).

## Reproducing it in a future deploy

The skill and playbook now come free with a clone of this repo — the old
"host-side agent state not captured by any backup" gap is closed for the
doctrine (this was the outcome the earlier Phase-4 note here anticipated).
To reproduce a running instance you must still restore/recreate:

1. the desk prompts' **"read `skill/` in this repo / promote to the playbook"**
   wiring (part of `~/.lucidindex/prompts/` — see
   [`deployment-reality.md`](./deployment-reality.md) §3–§4);
2. a checkout of this repo on the agent host, so the desks have `skill/` to read.

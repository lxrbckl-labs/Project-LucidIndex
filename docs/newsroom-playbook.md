# Newsroom playbook — the desks' trusted, permanent doctrine

LucidIndex ships no agents (see [`CLAUDE.md`](../CLAUDE.md) Key Constraints),
so this doc is a **pointer**, not the artifact: the playbook itself lives with
the external agent layer, not in this repo. But because it is part of what makes
the live instance work — and must be recreated to reproduce it — it is inventoried
here alongside the [`editorial-image-policy`](./editorial-image-policy.md) and the
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
| **`lucidindex-newsroom-playbook` skill** | **The doctrine itself** — the trusted, permanent house rules; read at the start of every run, appended to when the desks settle something durable. | `~/.claude/skills/lucidindex-newsroom-playbook/SKILL.md` (host), synced fleet-wide via `github.com/lxRbckl/Skills` |
| Desk prompts | Each desk is told to **read the playbook before its first pull** and to **promote settled forum conclusions into it** (then `sync.sh`). | `~/.lucidindex/prompts/the-{wire,desk,editor}.md` (host) |
| `lucidindex-agent` skill | The mechanical loop (auth, lock heartbeat, pull→research→write→ack) the playbook layers editorial/operational convention on top of. | `~/.claude/skills/lucidindex-agent/SKILL.md` |
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

Because it is host-side agent state, the playbook is **not** captured by the DB
backup (same gap as the desk prompts — see
[`deployment-reality.md`](./deployment-reality.md) §3–§4). To reproduce a
running instance you must also restore/recreate:

1. the `lucidindex-newsroom-playbook` skill (comes free with a `sync.sh` pull of
   the shared skills repo — it is fleet-synced, so a fresh machine gets it on
   first sync);
2. the desk prompts' **"read the playbook / promote to the playbook"** wiring
   (part of `~/.lucidindex/prompts/`).

When the Phase-4 reference agent repo (`Project-LucidIndex-Agent`) finally
exists, the desk prompts and this playbook are exactly the kind of non-secret
agent-layer artifact that should be version-controlled there.

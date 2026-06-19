# Editorial policy — every article needs a related image

**Policy:** every article published to LucidIndex must ship with a
`hero_image_url` that points to an image **clearly relevant to the
story** (its lead/OG image, or another on-topic photo). No image-less
articles, and no decorative/unrelated stock filler.

This keeps the magazine reading like a magazine — significance-driven
masonry tiles only look right when every card has a real, on-topic image.

## Where it's enforced vs. instructed

Presence is enforced in code; *relevance* is the agent's judgment, so it
is reinforced in every instruction surface an agent reads.

| Surface | Role | Location |
|---|---|---|
| **`write_articles` input schema** | **Hard gate** — `hero_image_url` is a required URL; an article without one is rejected at write time. | `apps/mcp-dashboard/src/tools/write-articles.ts` |
| Public tool catalog | Tells agents the field is required + must be related. | `apps/web/app/agents/_lib/tool-catalog.ts` |
| Editorial templates (per source) | The `rendered_prompt` agents follow each pull — states the image requirement. | Live DB → **Settings → Templates** (also the place to re-edit wording) |
| Desk prompts | Each desk's standing brief. | `~/.lucidindex/prompts/the-{wire,desk,editor}.md` (host) |
| `lucidindex-agent` skill | The shared agent protocol. | `~/.claude/skills/lucidindex-agent/SKILL.md` + `reference/mcp-contract.md` |

## Important nuance: presence vs. fetch success

- The schema enforces that a **URL is supplied**. It does **not** verify
  the image is on-topic — that's editorial judgment, driven by the
  instructions above.
- The hero-image **fetch/resize/store** step remains **non-fatal**: if a
  valid URL fails to download, the article still posts with
  `heroImageHash = null` (it just won't get a processed tile image).
  Agents are instructed to supply a working, relevant URL; a transient
  fetch failure should not silently drop an otherwise-good article.

## If you need to relax this

Make `hero_image_url` optional again in
`apps/mcp-dashboard/src/tools/write-articles.ts` (restore `.optional()`)
and soften the wording in the surfaces above. Prefer keeping the hard
gate — it's the only thing that *guarantees* no image-less articles slip
through.

## Related UI

Off-site references now live in a single **"Additional Resources"**
section on the article page (`apps/web/components/article/SourcesSection.tsx`)
— structured citations plus the cross-source "other coverage" links that
were previously a separate "Also covered by" card.

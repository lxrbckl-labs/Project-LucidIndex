/**
 * ArticleMasonry — significance-driven editorial grid (#57).
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Design/infinite_scroll.jpg
 * (the catalog of explicit tile subdivisions) and Visual Identity.md
 * ("Masonry — `infinite_scroll.jpg`").
 *
 * Approach:
 *
 *   - The dashboard is partitioned into PANELS of 6 articles each.
 *     Each panel picks one of N curated patterns and lays its
 *     articles into named grid areas via `grid-template-areas`.
 *
 *   - We do NOT use Pinterest-style packed masonry. The spec is
 *     explicit: "Pinterest-style packed-masonry that's 'uniform width,
 *     varied height' is wrong. We want the explicitly-subdivided
 *     patterns from `infinite_scroll.jpg`."
 *
 *   - Significance maps to tile size:
 *       small  → 1 col × 1 row   (named area "s1"…"s6")
 *       medium → 1 col × 2 rows  (named area "m1"…"m6")
 *       large  → 2 cols × 2 rows (named area "L1"…"L6")
 *
 *   - Each panel pattern is hand-curated from `infinite_scroll.jpg`.
 *     Six patterns shipped here; the catalog can grow without
 *     touching layout code.
 *
 * Tile assignment to a panel slot:
 *
 *   The panel's `slots` array describes the kind of tile each named
 *   area expects (`small` / `medium` / `large`). When we fill a panel
 *   we walk the article queue and grab the first article whose
 *   significance matches the next slot. Articles that don't fit in the
 *   current panel roll over to the next panel. This keeps the grid
 *   visually stable — significance and tile size always agree.
 */

import type { MockArticle, Significance } from '@/app/_mock/articles'
import { ArticleCard } from './ArticleCard'
import { LargeArticleCard } from './LargeArticleCard'

/**
 * A masonry panel — 4 columns × 4 rows, with a hand-curated set of
 * named areas. Each entry in `slots` declares one filled area, the
 * significance it expects, and the named area string used in the
 * panel's `gridTemplateAreas`.
 *
 * The unused cells in the panel grid stay as `.` (empty) in the area
 * string — that's the editorial breathing room the spec calls for
 * (whitespace + hairlines, no shadows).
 *
 * The six panels were curated from `Design/infinite_scroll.jpg`,
 * skipping the busiest rows (the 4×3 packed grids read cluttered)
 * and favoring patterns that put a large block next to two stacked
 * mediums, or a single column of mediums against a row of smalls.
 */
type PanelPattern = {
  /** Diagnostic label — comment-only, not rendered. */
  id: string
  /** `grid-template-areas` string. 4-column grid; each row is space-separated. */
  areas: string
  /** Slot definitions in render order. */
  slots: Array<{ area: string; significance: Significance }>
}

const PANELS: PanelPattern[] = [
  // ---------------------------------------------------------------
  // Panel A — large left, two mediums stacked right, smalls below.
  // Pattern reference: Design/infinite_scroll.jpg row 1, col 4.
  //
  //   ┌─────────────┬───────┬───────┐
  //   │             │       │       │
  //   │     L1      │  m1   │  m2   │
  //   │             │       │       │
  //   │             │       │       │
  //   ├─────┬───────┴───┬───┴───┬───┤
  //   │ s1  │    s2     │  s3   │ . │
  //   └─────┴───────────┴───────┴───┘
  // ---------------------------------------------------------------
  {
    id: 'A',
    areas: `
      "L1 L1 m1 m2"
      "L1 L1 m1 m2"
      "s1 s2 s3 ."
    `,
    slots: [
      { area: 'L1', significance: 'large' },
      { area: 'm1', significance: 'medium' },
      { area: 'm2', significance: 'medium' },
      { area: 's1', significance: 'small' },
      { area: 's2', significance: 'small' },
      { area: 's3', significance: 'small' },
    ],
  },
  // ---------------------------------------------------------------
  // Panel B — three small tiles top, large right, mediums below.
  // Reference: infinite_scroll row 5, col 2.
  // ---------------------------------------------------------------
  {
    id: 'B',
    areas: `
      "s1 s2 L1 L1"
      "m1 m2 L1 L1"
      "m1 m2 s3 ."
    `,
    slots: [
      { area: 's1', significance: 'small' },
      { area: 's2', significance: 'small' },
      { area: 'L1', significance: 'large' },
      { area: 'm1', significance: 'medium' },
      { area: 'm2', significance: 'medium' },
      { area: 's3', significance: 'small' },
    ],
  },
  // ---------------------------------------------------------------
  // Panel C — two mediums left, three smalls right + middle.
  // Reference: infinite_scroll row 4, col 1.
  // ---------------------------------------------------------------
  {
    id: 'C',
    areas: `
      "m1 m2 s1 s2"
      "m1 m2 s3 s4"
      "m1 m2 . ."
    `,
    slots: [
      { area: 'm1', significance: 'medium' },
      { area: 'm2', significance: 'medium' },
      { area: 's1', significance: 'small' },
      { area: 's2', significance: 'small' },
      { area: 's3', significance: 'small' },
      { area: 's4', significance: 'small' },
    ],
  },
  // ---------------------------------------------------------------
  // Panel D — large right, smalls scattered left.
  // Reference: infinite_scroll row 2, col 1.
  // ---------------------------------------------------------------
  {
    id: 'D',
    areas: `
      "s1 s2 L1 L1"
      "s3 s4 L1 L1"
      "s5 .  s6 ."
    `,
    slots: [
      { area: 's1', significance: 'small' },
      { area: 's2', significance: 'small' },
      { area: 'L1', significance: 'large' },
      { area: 's3', significance: 'small' },
      { area: 's4', significance: 'small' },
      { area: 's5', significance: 'small' },
      { area: 's6', significance: 'small' },
    ],
  },
  // ---------------------------------------------------------------
  // Panel E — column of mediums + row of smalls.
  // Reference: infinite_scroll row 3, col 1 (vertical bar pattern).
  // ---------------------------------------------------------------
  {
    id: 'E',
    areas: `
      "m1 s1 s2 m2"
      "m1 s3 s4 m2"
      ".  s5 s6 ."
    `,
    slots: [
      { area: 'm1', significance: 'medium' },
      { area: 's1', significance: 'small' },
      { area: 's2', significance: 'small' },
      { area: 'm2', significance: 'medium' },
      { area: 's3', significance: 'small' },
      { area: 's4', significance: 'small' },
      { area: 's5', significance: 'small' },
      { area: 's6', significance: 'small' },
    ],
  },
  // ---------------------------------------------------------------
  // Panel F — single large block flanked by smalls below.
  // Reference: infinite_scroll row 6, col 1.
  // ---------------------------------------------------------------
  {
    id: 'F',
    areas: `
      "L1 L1 m1 m2"
      "L1 L1 s1 s2"
      ".  s3 s4 ."
    `,
    slots: [
      { area: 'L1', significance: 'large' },
      { area: 'm1', significance: 'medium' },
      { area: 'm2', significance: 'medium' },
      { area: 's1', significance: 'small' },
      { area: 's2', significance: 'small' },
      { area: 's3', significance: 'small' },
      { area: 's4', significance: 'small' },
    ],
  },
]

/**
 * Greedy panel filler. Walks the article queue and fills slots in
 * order; if the current panel can't be satisfied by the remaining
 * articles, falls back to the panel that best matches what's left.
 *
 * This is intentionally simple — significance distribution from real
 * agents will be unpredictable, and a perfect bin-packer would look
 * mechanical. The greedy fall-through produces an editorial rhythm
 * where each panel reads "intentional", and any tail of leftover
 * articles renders in a final fallback panel.
 */
function buildPanels(articles: MockArticle[]): Array<{
  pattern: PanelPattern
  filled: Array<{ slot: PanelPattern['slots'][number]; article: MockArticle }>
}> {
  const queue = [...articles]
  const panels: Array<{
    pattern: PanelPattern
    filled: Array<{ slot: PanelPattern['slots'][number]; article: MockArticle }>
  }> = []

  let patternIdx = 0

  while (queue.length > 0) {
    // Pick the next pattern that we can at least partially satisfy.
    // Try patterns starting from the rotating index; fall back to the
    // first pattern whose first slot matches the next article.
    let pattern: PanelPattern | undefined

    for (let attempt = 0; attempt < PANELS.length; attempt++) {
      const candidate = PANELS[(patternIdx + attempt) % PANELS.length]
      if (!candidate) continue
      const requiredHead = candidate.slots[0]
      if (!requiredHead) continue
      if (queue.some((a) => a.significance === requiredHead.significance)) {
        pattern = candidate
        patternIdx = (patternIdx + attempt + 1) % PANELS.length
        break
      }
    }

    if (!pattern) {
      // Nothing in the queue matches any first-slot — render leftovers
      // in pattern A regardless. Visually rare; defensive.
      const fallback = PANELS[0]
      if (!fallback) break
      pattern = fallback
    }

    const filled: Array<{ slot: PanelPattern['slots'][number]; article: MockArticle }> = []

    for (const slot of pattern.slots) {
      const idx = queue.findIndex((a) => a.significance === slot.significance)
      if (idx >= 0) {
        const picked = queue[idx]
        if (picked) {
          filled.push({ slot, article: picked })
          queue.splice(idx, 1)
        }
      }
      // If no match: leave the slot empty. The named area collapses to
      // editorial whitespace, which is on-brand.
    }

    if (filled.length === 0) {
      // No articles could be placed at all — break to avoid infinite loop.
      break
    }

    panels.push({ pattern, filled })
  }

  return panels
}

type Props = {
  articles: MockArticle[]
}

export function ArticleMasonry({ articles }: Props) {
  const panels = buildPanels(articles)

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      {panels.map((panel) => {
        // A panel's key must be stable across re-renders without leaking
        // the array index. The first article in the panel is unique
        // within a render (greedy fill never reuses an article), so its
        // id namespaced by the panel's pattern is a stable identifier.
        const headArticleId = panel.filled[0]?.article.id ?? 'empty'
        const panelKey = `${panel.pattern.id}-${headArticleId}`

        return (
          <div
            key={panelKey}
            className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6"
            style={{
              gridTemplateAreas: panel.pattern.areas,
              // Each row in the named-area grid is one "tile-height" unit.
              // With a 4-col grid and the panels above, 3 rows works out to
              // a panel that's roughly 2:1 wide-to-tall on desktop.
              gridAutoRows: 'minmax(180px, auto)',
            }}
          >
            {panel.filled.map(({ slot, article }) => (
              <div key={article.id} style={{ gridArea: slot.area }} className="min-h-0">
                {slot.significance === 'large' ? (
                  <LargeArticleCard article={article} />
                ) : (
                  <ArticleCard article={article} />
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * ArticleMasonry — significance-driven editorial grid (#57).
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Design/infinite_scroll.jpg
 * (the catalog of explicit tile subdivisions) and Visual Identity.md
 * ("Masonry — `infinite_scroll.jpg`").
 *
 * Approach (desktop, ≥1024px):
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
 * Phase 8 #81 — responsive variants:
 *
 *   - Tablet (640-1023px): 2-column flow grid. Significance still drives
 *     tile height (small = 1 row, medium / large = 2 rows). The 6-pattern
 *     named-areas don't apply — a simple 2-col grid where tiles flow
 *     naturally preserves the editorial rhythm without trying to scale
 *     the desktop patterns down.
 *   - Mobile (≤639px): single-column flow. Tiles stack vertically.
 *     Significance still drives the hero aspect (large gets a full-bleed
 *     dramatic hero; medium and small keep their portrait/square
 *     proportions). Card padding tightens but stays editorial.
 *
 *   The breakpoint switch uses Tailwind's `sm:` (≥640px) and `lg:`
 *   (≥1024px) utilities. Below `sm:`, single column; between `sm:` and
 *   `lg:`, two columns; at `lg:` and up, the 6-pattern masonry.
 *
 *   The panel's `grid-template-areas` is applied at desktop only via a
 *   <style> block scoped to the panel's `data-panel-idx` and the
 *   masonry instance's `data-masonry-scope`. The tile's `grid-area`
 *   (e.g. "L1") is set unconditionally — at sub-lg sizes it names an
 *   undefined area, which CSS Grid handles by falling back to
 *   auto-placement (per CSS Grid spec — an undefined named area resolves
 *   to `auto / auto / auto / auto`). The per-tile `grid-row: span N`
 *   rule keeps the significance-driven height variation alive at tablet
 *   and mobile.
 *
 * Phase 8 #84 — keyboard navigation:
 *
 *   - The keyboard handler lives in a thin client component
 *     (MasonryKeyboardNav) mounted by the dashboard route alongside
 *     this masonry. That keeps ArticleMasonry / ArticleCard pure
 *     server components (so server-only env vars in BASE_URL keep
 *     resolving correctly).
 *   - Tiles carry `data-masonry-tile=""` so the handler can enumerate
 *     them via `document.querySelectorAll`. See ArticleCard for the
 *     attribute placement.
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
  /**
   * Set of article ids that should render the "NEW" pill (#79). Computed
   * upstream by the dashboard route — the masonry stays stateless and
   * just forwards the flag to each card.
   */
  newArticleIds?: ReadonlySet<string>
}

/**
 * Mobile/tablet flow row-span per significance. Mirrors the desktop
 * spirit (large > medium > small) without trying to retro-fit the
 * 6-pattern 4-col grid into 1 or 2 columns. Two rows for medium and
 * large makes those tiles visibly taller against the `auto-rows:
 * minmax(180px, auto)` floor; small tiles stay one row.
 */
function rowSpanForSignificance(s: Significance): number {
  if (s === 'large') return 2
  if (s === 'medium') return 2
  return 1
}

export function ArticleMasonry({ articles, newArticleIds }: Props) {
  const panels = buildPanels(articles)

  // Build the per-panel desktop-only `grid-template-areas` rules in a
  // single <style> block. Below 1024px the panel grids fall back to
  // flow placement (1 col on mobile, 2 cols on tablet) — see the
  // per-panel className.
  //
  // Distinct named-area slots used across all 6 panels: L1, m1, m2,
  // s1-s6. We emit one rule per slot that reads `data-area="<slot>"`
  // and sets `grid-area: <slot>`. Setting it via CSS (rather than
  // inline style) keeps the desktop-template behavior wallpaper-
  // tightly scoped to ≥1024px — at sub-lg, the rule doesn't fire and
  // tiles auto-place + use the `lucidindex-tile-span-N` class for
  // their row span.
  const desktopAreasCss = panels
    .map((panel, i) => {
      const flat = panel.pattern.areas.replace(/\s+/g, ' ').trim()
      return `[data-panel-idx="${i}"] { grid-template-areas: ${flat}; }`
    })
    .join('\n')

  // Distinct slot names emitted. Static across all six panels but the
  // set lives in the patterns; build it dynamically so adding a panel
  // with new slot names doesn't silently break grid-area resolution.
  const slotNames = Array.from(new Set(panels.flatMap((p) => p.filled.map((f) => f.slot.area))))
  const desktopGridAreaCss = slotNames
    .map((name) => `[data-area="${name}"] { grid-area: ${name}; }`)
    .join('\n')

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <style>{`
@media (min-width: 1024px) {
  ${desktopAreasCss}
  ${desktopGridAreaCss}
}
`}</style>
      {panels.map((panel, panelIdx) => {
        // A panel's key must be stable across re-renders without leaking
        // the array index. The first article in the panel is unique
        // within a render (greedy fill never reuses an article), so its
        // id namespaced by the panel's pattern is a stable identifier.
        const headArticleId = panel.filled[0]?.article.id ?? 'empty'
        const panelKey = `${panel.pattern.id}-${headArticleId}`

        return (
          <div
            key={panelKey}
            data-panel-idx={panelIdx}
            // Three-tier responsive grid:
            //   <sm  (≤639px) — single column, auto rows.
            //   sm:  (640-1023px) — 2-col grid; tiles get row-span by
            //                       significance so large/medium tiles
            //                       read taller.
            //   lg:  (≥1024px) — 4-col grid with named template areas
            //                    (the 6-pattern desktop masonry, applied
            //                    via the <style> block above).
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-6"
            style={{
              // Each row in the named-area grid is one "tile-height" unit.
              // With a 4-col grid and the panels above, 3 rows works out
              // to a panel that's roughly 2:1 wide-to-tall on desktop.
              // The same row floor works on tablet and mobile; large and
              // medium tiles span 2 rows below to keep their dramatic
              // proportions.
              gridAutoRows: 'minmax(180px, auto)',
            }}
          >
            {panel.filled.map(({ slot, article }) => {
              const isNew = newArticleIds?.has(article.id) ?? false
              const span = rowSpanForSignificance(slot.significance)
              return (
                <div
                  key={article.id}
                  // Phase 8 #81 — `data-area` carries the named-area for
                  // the desktop template; the per-masonry <style> block
                  // above wires `data-panel-idx` panels into a
                  // grid-template-areas rule, and a separate desktop-
                  // only rule reads `data-area` to set the tile's
                  // `grid-area` (so we don't have to set it inline,
                  // which would override the row-span at tablet/mobile).
                  // At ≤1023px the `lucidindex-tile-span-N` class drives
                  // the row span. At ≥1024px the named area's implicit
                  // span (from the template) drives it.
                  className={`min-h-0 lucidindex-tile-span-${span}`}
                  data-area={slot.area}
                >
                  {slot.significance === 'large' ? (
                    <LargeArticleCard article={article} isNew={isNew} />
                  ) : (
                    <ArticleCard article={article} isNew={isNew} />
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

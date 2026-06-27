/**
 * SiteFooter — sitewide footer.
 *
 * Layout: a centered tagline flanked by full-bleed hairline rules
 * (`flex-1 h-px`) that fill the remaining space on each side:
 *
 *   ───────────── tagline ─────────────
 *
 * The middle slot is a decorative italic phrase — `pointer-events-none`
 * + `select-none` so it can't be hovered, clicked, or selected.
 *
 * Rendered at the bottom of every "scrolling" page (dashboard, article,
 * creator, favorites, starred, settings). Forum is excluded — that page
 * is an `h-screen overflow-hidden` auth gate.
 */

export function SiteFooter() {
  return (
    <footer className="px-4 py-4 text-sm">
      {/*
        Three equal-width columns. The grid (not flex) keeps the middle
        column centered to the page; the side columns are each just a
        hairline rule filling their half.
      */}
      <div className="grid grid-cols-3 items-center gap-0 text-muted-foreground">
        <div className="flex items-center">
          <span className="h-px flex-1 bg-muted-foreground/40" aria-hidden="true" />
        </div>
        <p className="text-center italic select-none pointer-events-none">Read deliberately.</p>
        <div className="flex items-center">
          <span className="h-px flex-1 bg-muted-foreground/40" aria-hidden="true" />
        </div>
      </div>
    </footer>
  )
}

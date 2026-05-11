/**
 * SiteFooter — sitewide footer.
 *
 * Layout: a single horizontal row, three segments connected by
 * full-bleed hairline rules (`flex-1 h-px`) that fill the space between
 * text:
 *
 *   LucidIndex ───────── tagline ───────── GitHub
 *
 * The middle slot is a decorative italic phrase — `pointer-events-none`
 * + `select-none` so it can't be hovered, clicked, or selected.
 *
 * Rendered at the bottom of every "scrolling" page (dashboard, article,
 * creator, favorites, starred, settings). Forum is excluded — that page
 * is an `h-screen overflow-hidden` auth gate.
 */

const REPO_URL = 'https://github.com/lxrbckl-dev/Project-LucidIndex'

/**
 * Inline GitHub-mark SVG. lucide-react dropped brand icons (trademark
 * reasons) so we ship the mark inline. `fill="currentColor"` lets the
 * icon inherit the surrounding text color (`text-muted-foreground` on
 * the parent footer).
 */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.071 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

export function SiteFooter() {
  return (
    <footer className="px-4 py-4 text-sm">
      {/*
        Three equal-width columns. The grid (not flex) is what makes the
        middle column centered to the page rather than centered between
        the two side anchors — LUCIDINDEX and GitHub have different
        widths, so a flex layout with `flex-1` fillers would drift the
        italic phrase off the viewport's true center.

        Outer grid `gap-2` keeps the side hairlines tight against the
        center italic phrase; inner column `gap-4` keeps the wordmark
        and link comfortably separated from their respective lines.
      */}
      <div className="grid grid-cols-3 items-center gap-0 text-muted-foreground">
        <div className="flex items-center gap-4">
          <p className="shrink-0 text-xs uppercase tracking-[0.2em]">LucidIndex</p>
          <span className="h-px flex-1 bg-muted-foreground/40" aria-hidden="true" />
        </div>
        <p className="text-center italic select-none pointer-events-none">Read deliberately.</p>
        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-muted-foreground/40" aria-hidden="true" />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 inline-flex items-center gap-1.5 hover:underline underline-offset-2"
          >
            <GitHubMark className="h-5 w-5" />
            GitHub
          </a>
        </div>
      </div>
    </footer>
  )
}

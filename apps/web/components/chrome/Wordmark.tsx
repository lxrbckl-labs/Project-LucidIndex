/**
 * Wordmark — the page-spanning "LUCIDINDEX" mark (#55).
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Visual Identity.md
 * ("page-spanning wordmark") and `Design/main.jpg` (Fyrre cover).
 *
 * Sizing decisions:
 *   - Uses `--text-display-xl` from `globals.css` so the same scale
 *     drives both the public landing wordmark and the authenticated
 *     dashboard wordmark. The token is `clamp(4rem, 12vw, 9rem)` —
 *     it fluidly grows on wider viewports without ever exceeding the
 *     tile-size budget the masonry below it expects.
 *   - All-caps, condensed, ultra-bold. Negative letter-spacing keeps
 *     the wordmark dense — Fyrre style is "tight word, generous air
 *     around it".
 *   - Center-aligned per spec, with generous vertical breathing room
 *     above and below — that whitespace IS the visual emphasis.
 *
 * Pure server component — semantically an `<h1>` so the page has a
 * single, well-formed top-level heading regardless of whether the
 * empty state or the masonry renders below.
 */

export function Wordmark() {
  return (
    <h1
      className="text-[length:var(--text-display-xl)] font-black leading-none tracking-tight text-ink uppercase w-full text-center"
      style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
    >
      LUCIDINDEX
    </h1>
  )
}

/**
 * URL-safe slug generation for the article page (#65).
 *
 * Slugs are the canonical identifier in `/a/<slug>` — the share-link
 * target — so they need to be:
 *
 *   - Deterministic. Same `(title, date)` always yields the same slug
 *     so a republish of the same source over a stable cron run never
 *     thrashes the URL.
 *   - URL-safe. Lowercase, ASCII, hyphen-separated, no punctuation that
 *     forces percent-encoding.
 *   - Bounded. 80-char ceiling on the title portion keeps the final
 *     `<date>-<title>` form well under typical URL length budgets.
 *
 * Collision handling is two-stage:
 *
 *   1. `generateSlug(title, date)` is the deterministic primary form.
 *   2. `disambiguate(slug, sourceUrl)` appends a 6-char content hash
 *      derived from the source URL when the primary form collides on
 *      the unique constraint. The hash is stable per source URL — a
 *      retry of the same write produces the same disambiguated slug,
 *      which keeps an INSERT idempotent under a real unique-violation
 *      retry loop.
 *
 * Why split into two functions instead of always disambiguating: the
 * dashboard slug should read as a clean URL by default; only collisions
 * pay the readability cost of a hash suffix. And callers (mcp-dashboard
 * `write_articles`) do their own DB-level retry — they need both the
 * "first try" form and the "retry" form distinct.
 *
 * Note on date input: callers pass `Date | string` — a string is
 * interpreted via `new Date(...)` and reduced to its ISO date prefix
 * (`YYYY-MM-DD`). UTC is the contract; the publish-day pill on the
 * article page derives its display label from a separate field (the
 * raw `source_published_at` timestamp), not the slug, so a UTC slug
 * with a local-tz pill is correct and unambiguous.
 */

import { createHash } from 'node:crypto'

/**
 * Build a URL-safe slug from a title + ISO date.
 *
 * Output shape: `YYYY-MM-DD-<kebab-title>` — date prefix keeps slugs
 * lexicographically sortable on disk-listing or log-grep, and helps
 * humans reading a share link recognize the article era at a glance.
 *
 * Empty / unprintable titles fall back to `article` so the result is
 * always a non-empty slug body. (Real article titles are required at
 * the schema level — this is a defense-in-depth fallback.)
 */
export function generateSlug(title: string, date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  // Defensive: an unparseable string becomes `Invalid Date` whose
  // ISO form throws. Fall back to "now" on bad input so the slug call
  // never crashes a write path.
  const iso = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  const dateStr = iso.split('T')[0] ?? ''

  const slugBase = title
    .toLowerCase()
    // Strip curly + straight apostrophes BEFORE the punctuation pass so
    // "World's biggest" becomes "worlds-biggest", not "world-s-biggest".
    .replace(/['‘’]/g, '')
    // Anything that isn't a-z / 0-9 collapses to a single hyphen.
    .replace(/[^a-z0-9]+/g, '-')
    // Trim leading/trailing hyphens left over from punctuation runs.
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return `${dateStr}-${slugBase || 'article'}`
}

/**
 * Append a 6-char source-URL content hash to disambiguate a slug
 * collision. The hash is stable per source URL — calling this twice
 * with the same `(slug, sourceUrl)` returns the same disambiguated
 * form, which is what a `write_articles` retry needs to stay
 * idempotent on the unique constraint.
 *
 * 6 hex chars = 24 bits = ~16M values. The collision window is "two
 * articles published on the same day with the same title from
 * different source URLs whose first 6 hex sha256 chars also match" —
 * astronomically unlikely; not worth a longer suffix.
 */
export function disambiguate(slug: string, sourceUrl: string): string {
  const hash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 6)
  return `${slug}-${hash}`
}

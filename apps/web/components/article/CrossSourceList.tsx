/**
 * CrossSourceList — "Other coverage" rendering refinement (#80).
 *
 * Extracted from `apps/web/app/a/[slug]/page.tsx` so the visual treatment
 * lives in one place. The article anatomy (#66) already rendered cross-
 * source as a hairline-bordered list; this component tightens the spec
 * per Visual Identity: text-only ("no images"), small-caps eyebrow
 * heading, hairline rules between entries, restrained hover states.
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Visual Identity.md.
 *
 * Anatomy:
 *
 *   ────────────────────────────────────────────  ← hairline rule above
 *   OTHER COVERAGE                                ← eyebrow, small-caps
 *
 *     <Title — body weight, links out>            ← per-entry block,
 *     PUBLISHER — meta, italic, muted               hairline rule between
 *     ────────────────────────────────────────
 *     <Title — body weight, links out>
 *     PUBLISHER — meta, italic, muted
 *
 * Hard rules from the spec:
 *   - Text-only — no thumbnails, no avatars, no source-icon glyphs.
 *   - Hairline border above and between entries (no shadows, no fills).
 *   - Hidden entirely when `entries.length === 0` — caller's
 *     responsibility to guard, but the component also no-ops on empty
 *     so a stray render doesn't draw an empty section.
 *   - Links open in a new tab (`target="_blank"` + `rel="noopener
 *     noreferrer"`) — these are off-site, so a same-tab navigation
 *     would lose the article context.
 *
 * Server component — pure render, no interactivity.
 */

import Link from 'next/link'
import type { ArticleCrossSource } from '@/app/a/[slug]/loader'

type Props = {
  entries: ArticleCrossSource[]
}

export function CrossSourceList({ entries }: Props) {
  if (entries.length === 0) return null

  return (
    <section
      className="mt-8 border-t border-[var(--color-card-border)] pt-6"
      data-testid="article-cross-source"
    >
      {/* Eyebrow — small-caps "OTHER COVERAGE". Mirrors the date / topic-
          badge eyebrow rhythm used elsewhere on the article page. */}
      <h2 className="text-sm uppercase tracking-[0.16em] text-[var(--color-muted-700)] mb-3">
        Other coverage
      </h2>

      <ul className="divide-y divide-[var(--color-card-border)]">
        {entries.map((entry) => (
          <li key={`${entry.source_url}-${entry.title}`} className="py-4">
            <Link
              href={entry.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block no-underline"
            >
              {/* Title — body type, ink, underline-on-hover. Inline span
                  carries the underline so it matches the link bounds
                  rather than the whole row. */}
              <span className="block text-[length:var(--text-body)] leading-snug text-ink underline-offset-4 group-hover:underline">
                {entry.title}
              </span>
              {entry.publisher ? (
                <span className="mt-1 block text-[var(--text-meta)] italic text-[var(--color-muted-500)]">
                  {entry.publisher}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

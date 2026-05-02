/**
 * CrossSourceList — "Other coverage" rendering refinement (#80).
 *
 * Phase 5 rebuild: shadcn `<Card>` container with `<CardHeader>` title
 * "Also covered by" and `<Separator />`-divided entry list.
 *
 * The article anatomy (#66) already rendered cross-source as a
 * hairline-bordered list; this component tightens the spec per Visual
 * Identity: text-only ("no images"), small-caps eyebrow heading, hairline
 * rules between entries, restrained hover states.
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Visual Identity.md.
 *
 * Hard rules from the spec:
 *   - Text-only — no thumbnails, no avatars, no source-icon glyphs.
 *   - Separator between entries (no shadows, no fills).
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

type Props = {
  entries: ArticleCrossSource[]
}

export function CrossSourceList({ entries }: Props) {
  if (entries.length === 0) return null

  return (
    <Card className="mt-8" data-testid="article-cross-source">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-[0.16em] text-muted-foreground font-normal">
          Also covered by
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul>
          {entries.map((entry, idx) => (
            <li key={`${entry.source_url}-${entry.title}`}>
              {idx > 0 && <Separator className="my-0" />}
              <Link
                href={entry.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block py-4 no-underline"
              >
                {/* Title — body type, ink, underline-on-hover. */}
                <span className="block text-base leading-snug text-foreground underline-offset-4 group-hover:underline">
                  {entry.title}
                </span>
                {entry.publisher ? (
                  <span className="mt-1 block text-xs italic text-muted-foreground">
                    {entry.publisher}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

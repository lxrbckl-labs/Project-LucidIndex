/**
 * CitationsSection — collapsible Citations block on the post view.
 *
 * Mirrors the shape of `components/article/AgentOpinionSection.tsx`:
 * a small-caps trigger row + ChevronDown that rotates 180° when open,
 * shadcn Collapsible owning the open state. Default closed.
 *
 * Each citation entry wraps its hyperlink in a HoverCard whose content
 * shows the cited post's title, author byline (with optional agent
 * badge), a short body excerpt, and a relative timestamp — same shape
 * the inline `@PostN` hover previews use, so both surfaces feel identical.
 *
 * Pulled out of PostView so PostView can stay an RSC (server-side
 * markdown rendering preserved) while the Collapsible + HoverCard get
 * the `'use client'` boundary they need.
 */

'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import type { PostViewCitation } from './PostView'

type Props = {
  citations: PostViewCitation[]
}

const EXCERPT_MAX = 200

/**
 * Strip the composer's `@Image\d+` / `@Post\d+` / `@<username>` tokens
 * from the body before truncating for the hover preview. Same shape as
 * the feed's `makeExcerpt`, just a shorter target (200 chars).
 */
function makeExcerpt(body: string): string {
  const stripped = body
    .replace(/@(?:Image|Post)\d+/g, '')
    .replace(/@[a-z][a-z0-9_-]{2,19}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (stripped.length <= EXCERPT_MAX) return stripped
  return `${stripped.slice(0, EXCERPT_MAX - 1)}…`
}

/**
 * Render the post's age relative to now. Duplicated from
 * `apps/web/app/forum/page.tsx` per assignment — single re-use site,
 * not worth a shared util.
 */
function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

/**
 * Standalone export so PostView can wrap inline `@PostN` links in the
 * same preview without duplicating layout.
 */
export function CitationHoverContent({ citation }: { citation: PostViewCitation }) {
  return (
    <HoverCardContent className="w-80">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold leading-snug text-foreground">{citation.citedTitle}</p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>@{citation.citedAuthorUsername}</span>
          <span>·</span>
          <span>{relativeTime(citation.citedCreatedAt)}</span>
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {makeExcerpt(citation.citedBody)}
        </p>
      </div>
    </HoverCardContent>
  )
}

export function CitationsSection({ citations }: Props) {
  const [open, setOpen] = useState(false)

  if (citations.length === 0) return null

  const ordered = citations.slice().sort((a, b) => a.sequenceNumber - b.sequenceNumber)

  return (
    <section className="mt-10 border-t border-border" data-testid="citations-section">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between py-4 text-left">
          <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Citations
          </h3>
          <ChevronDown
            className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180"
            data-state={open ? 'open' : 'closed'}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol className="flex list-decimal flex-col gap-1.5 pb-4 pl-5 text-sm">
            {ordered.map((c) => (
              <li key={c.citedPostId} data-testid={`citation-item-${c.sequenceNumber}`}>
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <a
                      href={`/forum/posts/${c.citedPostId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {c.citedTitle}
                    </a>
                  </HoverCardTrigger>
                  <CitationHoverContent citation={c} />
                </HoverCard>{' '}
                <span className="text-muted-foreground">— @{c.citedAuthorUsername}</span>
              </li>
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

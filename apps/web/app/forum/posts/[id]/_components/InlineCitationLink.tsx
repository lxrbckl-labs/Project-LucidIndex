/**
 * InlineCitationLink — client wrapper that renders an inline `@PostN`
 * citation link with the shared HoverCard preview.
 *
 * Kept as a thin, focused client component so PostView's `parseBody`
 * loop can stay in the RSC. The preview content lives in
 * `CitationsSection.tsx` (`CitationHoverContent`) — both surfaces share
 * the same data shape and visual treatment so a citation feels identical
 * whether the reader hits it inline or at the bottom of the post.
 */

'use client'

import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card'
import { CitationHoverContent } from './CitationsSection'
import type { PostViewCitation } from './PostView'

type Props = {
  citation: PostViewCitation
}

export function InlineCitationLink({ citation }: Props) {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a
          href={`/forum/posts/${citation.citedPostId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          data-testid={`citation-inline-${citation.sequenceNumber}`}
        >
          {citation.citedTitle}
        </a>
      </HoverCardTrigger>
      <CitationHoverContent citation={citation} />
    </HoverCard>
  )
}

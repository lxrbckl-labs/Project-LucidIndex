/**
 * AgentOpinionSection — collapsible "Agent opinion" section on the article
 * detail page. Mirrors the shape of SourcesSection exactly.
 *
 * Positioned AFTER SourcesSection (which already provides its own bottom
 * Separator). This component opens with a top Separator to bracket the section.
 *
 * Always rendered — when `agentOpinion` is null a muted placeholder is shown
 * so the section is always discoverable.
 */

'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'

type Props = {
  agentOpinion: string | null
}

export function AgentOpinionSection({ agentOpinion }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-0" data-testid="article-agent-opinion">
      <Separator />
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between py-4 text-left">
          <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Agent opinion
          </h3>
          <ChevronDown
            className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180"
            data-state={open ? 'open' : 'closed'}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pb-4">
            {agentOpinion ? (
              <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground text-justify">
                {agentOpinion}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No opinion recorded yet.</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

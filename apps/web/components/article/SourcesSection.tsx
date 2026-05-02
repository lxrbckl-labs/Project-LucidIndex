/**
 * SourcesSection — collapsible "Sources" section on the article detail page.
 *
 * Renders a horizontal separator + collapsible block (closed by default):
 *   - Trigger: "Sources" heading + chevron (rotates 180° when open)
 *   - Content: original source row + citation list
 *
 * Server component — pure render, no interactivity.
 */

'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { ArticleCitation } from '@/app/a/[slug]/loader'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'

type Props = {
  citations: ArticleCitation[]
}

/**
 * Derive a favicon URL for a given citation URL using Google's favicon
 * service. Falls back gracefully — on error the browser shows nothing.
 */
function faviconUrl(citationUrl: string): string {
  try {
    const { hostname } = new URL(citationUrl)
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`
  } catch {
    return ''
  }
}

/**
 * Format a date string (ISO or date-like) into "D Month YYYY" using UTC,
 * matching the article-page filed-date format.
 */
function formatAccessedDate(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  const day = d.getUTCDate()
  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(d)
  const year = d.getUTCFullYear()
  return `${day} ${month} ${year}`
}

export function SourcesSection({ citations }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-8" data-testid="article-sources">
      <Separator />
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between py-4 text-left">
          <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Additional Citations
          </h3>
          <ChevronDown
            className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180"
            data-state={open ? 'open' : 'closed'}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-4 pb-4">
            {/* Citations — only rendered when non-empty */}
            {citations.length > 0 ? (
              <div>
                <ul className="flex flex-col gap-1">
                  {citations.map((c) => (
                    <li key={c.url}>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors"
                      >
                        {/* Thumbnail */}
                        <div className="shrink-0 w-20 h-[60px] rounded-md border border-border overflow-hidden bg-muted flex items-center justify-center">
                          {c.image_url ? (
                            // biome-ignore lint/performance/noImgElement: external citation thumbnails — next/image requires configured domain list; plain img with lazy loading is intentional here
                            <img
                              src={c.image_url}
                              alt=""
                              width={80}
                              height={60}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            // biome-ignore lint/performance/noImgElement: favicon fallback for citations — external google favicon service; plain img is intentional
                            <img
                              src={faviconUrl(c.url)}
                              alt=""
                              width={32}
                              height={32}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="w-8 h-8 object-contain"
                            />
                          )}
                        </div>

                        {/* Text content */}
                        <div className="flex flex-col gap-1 min-w-0">
                          <Badge variant="secondary" className="shrink-0 self-start">
                            {c.source_name}
                          </Badge>
                          <span className="text-sm text-foreground leading-snug line-clamp-2">
                            {c.title}
                          </span>
                          {c.accessed_at ? (
                            <span className="text-xs text-muted-foreground">
                              Accessed {formatAccessedDate(c.accessed_at)}
                            </span>
                          ) : null}
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

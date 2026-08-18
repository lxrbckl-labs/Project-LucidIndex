/**
 * SourcesSection — collapsible "Additional Resources" section on the
 * article detail page.
 *
 * Renders a horizontal separator + collapsible block (closed by default):
 *   - Trigger: "Additional Resources" heading + chevron (rotates 180° when open)
 *   - Content: a single unified list of external resources, combining
 *     structured citations (comparison sources, with thumbnails) and
 *     cross-source "other coverage" links (text-only, favicon fallback).
 *
 * Cross-source entries were formerly a separate "Also covered by" card;
 * they now fold into this list so all off-site resources live in one place.
 *
 * Renders nothing when there are no resources of either kind.
 *
 * Client component — the collapsible needs interactivity.
 */

'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { ArticleCitation, ArticleCrossSource } from '@/app/a/[slug]/loader'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'

type Props = {
  citations: ArticleCitation[]
  crossSource?: ArticleCrossSource[]
}

/**
 * A flattened resource row — the common shape both citations and
 * cross-source entries render as in the unified list.
 */
type ResourceItem = {
  key: string
  url: string
  title: string
  /** Badge label — the comparison-source name, or the publisher / host for cross-source. */
  sourceName: string
  imageUrl?: string | null
  accessedAt?: string
}

/**
 * Derive a favicon URL for a given URL using Google's favicon service.
 * Falls back gracefully — on error the browser shows nothing.
 */
function faviconUrl(url: string): string {
  try {
    const { hostname } = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`
  } catch {
    return ''
  }
}

/** Best-effort hostname for a URL, used as a fallback badge label. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Source'
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

export function SourcesSection({ citations, crossSource = [] }: Props) {
  const [open, setOpen] = useState(false)

  // Structured citations first, then the folded-in cross-source coverage.
  const items: ResourceItem[] = [
    ...citations.map((c) => ({
      key: `cite:${c.url}`,
      url: c.url,
      title: c.title,
      sourceName: c.source_name,
      imageUrl: c.image_url,
      accessedAt: c.accessed_at,
    })),
    ...crossSource.map((cs) => ({
      key: `cross:${cs.source_url}`,
      url: cs.source_url,
      title: cs.title,
      sourceName: cs.publisher ?? hostLabel(cs.source_url),
    })),
  ]

  if (items.length === 0) return null

  return (
    <div className="mt-8" data-testid="article-sources">
      <Separator />
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between py-4 text-left">
          <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Additional Resources
          </h3>
          <ChevronDown
            className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180"
            data-state={open ? 'open' : 'closed'}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-4 pb-4">
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <li key={item.key}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors"
                  >
                    {/* Thumbnail */}
                    <div className="shrink-0 w-20 h-[60px] rounded-md border border-border overflow-hidden bg-muted flex items-center justify-center">
                      {item.imageUrl ? (
                        // biome-ignore lint/performance/noImgElement: external citation thumbnails — next/image requires configured domain list; plain img with lazy loading is intentional here
                        <img
                          src={item.imageUrl}
                          alt=""
                          width={80}
                          height={60}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        // biome-ignore lint/performance/noImgElement: favicon fallback — external google favicon service; plain img is intentional
                        <img
                          src={faviconUrl(item.url)}
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
                        {item.sourceName}
                      </Badge>
                      <span className="text-sm text-foreground leading-snug line-clamp-2">
                        {item.title}
                      </span>
                      {item.accessedAt ? (
                        <span className="text-xs text-muted-foreground">
                          Accessed {formatAccessedDate(item.accessedAt)}
                        </span>
                      ) : null}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

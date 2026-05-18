/**
 * GallerySection — collapsible Gallery block on the post view.
 *
 * Mirrors `CitationsSection.tsx`: a small-caps trigger row + ChevronDown
 * that rotates 180° when open, shadcn Collapsible owning the open state.
 * Default closed.
 *
 * Lists every uploaded image whose `@ImageN` token DOES NOT appear in
 * the post body — the "unreferenced" set. PostView passes only that
 * filtered subset in; this component doesn't filter itself. Returns
 * null when the list is empty so the section disappears entirely.
 *
 * Pulled out of PostView so PostView can stay an RSC (server-side
 * markdown rendering preserved) while the Collapsible gets its
 * `'use client'` boundary.
 */

'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { PostViewImage } from './PostView'

type Props = {
  images: PostViewImage[]
}

export function GallerySection({ images }: Props) {
  const [open, setOpen] = useState(false)

  if (images.length === 0) return null

  return (
    <section className="mt-10 border-t border-border" data-testid="gallery-section">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between py-4 text-left">
          <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Gallery
          </h3>
          <ChevronDown
            className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180"
            data-state={open ? 'open' : 'closed'}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3">
            {images.map((img) => (
              <li
                key={img.imageHash + img.sequenceNumber}
                className="flex flex-col gap-1 rounded-md border bg-card p-2"
              >
                <div className="aspect-square w-full overflow-hidden rounded-sm bg-muted">
                  {/* biome-ignore lint/performance/noImgElement: bytes served by /i/<hash> route handler */}
                  <img
                    src={`/i/${img.imageHash}`}
                    alt={`Inline reference @Image${img.sequenceNumber}`}
                    className="h-full w-full object-cover"
                  />
                </div>
                <code className="font-mono text-[11px] text-muted-foreground">
                  @Image{img.sequenceNumber}
                </code>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

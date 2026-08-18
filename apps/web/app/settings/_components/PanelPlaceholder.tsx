/**
 * Shared empty-state shell — shadcn Card + Skeleton (Phase 2).
 *
 * Previously used raw Tailwind; rebuilt as a shadcn Card with Skeleton
 * rows as placeholders. Real panels replace their `<PanelPlaceholder>`
 * call with actual content.
 */

import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export type PanelPlaceholderProps = {
  title: string
  phase: string
  /** Single sentence describing what this panel will do. */
  summary: string
  /** Optional extra paragraph(s) — e.g. callouts about ticket numbers. */
  children?: ReactNode
}

export function PanelPlaceholder(props: PanelPlaceholderProps) {
  const { title, phase, summary, children } = props
  return (
    <div className="max-w-[640px] flex flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{phase}</p>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{summary}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {children ? (
            <div className="text-sm text-muted-foreground leading-relaxed space-y-3">
              {children}
            </div>
          ) : (
            <>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

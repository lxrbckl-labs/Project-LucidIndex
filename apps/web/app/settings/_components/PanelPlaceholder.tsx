/**
 * Shared empty-state shell for every Phase 1 sub-panel.
 *
 * Phase 2 / Phase 7 will replace each `<PanelPlaceholder>` call with the
 * real CRUD UI. Keeping the visual shell here so all eight placeholders
 * read consistently and a future swap is one file at a time.
 */

import type { ReactNode } from 'react'

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
    <div className="max-w-[640px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">{phase}</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        {title}
      </h1>
      <div className="mt-6 mb-10 h-px w-full bg-neutral-200" />
      <p className="text-lg font-semibold text-black leading-snug">{summary}</p>
      <div className="mt-4 text-sm text-neutral-600 leading-relaxed space-y-3">{children}</div>
    </div>
  )
}

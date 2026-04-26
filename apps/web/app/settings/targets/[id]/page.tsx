/**
 * Settings → Targets → Edit (RSC).
 *
 * Loads the existing target + prompt-template options server-side, then
 * renders the same `<TargetForm>` in `mode="edit"`. 404s if the id doesn't
 * exist. Cron-managed fields (next_due_at, last_run_*) are shown as a
 * read-only side panel underneath the form — they're owned by the Phase 4
 * cron sidecar / Phase 3 mcp-store.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TargetForm } from '../_components/TargetForm'
import {
  CADENCE_PRESETS,
  getTarget,
  hasAnyPromptTemplates,
  listPromptTemplateOptions,
} from '../_lib/targets-repo'

export const dynamic = 'force-dynamic'

export default async function EditTargetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [target, promptTemplates, templatesAvailable] = await Promise.all([
    getTarget(id),
    listPromptTemplateOptions(),
    hasAnyPromptTemplates(),
  ])
  if (!target) notFound()

  return (
    <div className="max-w-[640px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        Edit target
      </h1>
      <div className="mt-6 mb-8 h-px w-full bg-neutral-200" />

      <Link
        href="/settings/targets"
        className="text-xs uppercase tracking-wide text-neutral-500 hover:text-black mb-6 inline-block"
      >
        &larr; Back to targets
      </Link>

      <TargetForm
        mode="edit"
        targetId={target.id}
        initial={{
          label: target.label,
          urlOrHandle: target.urlOrHandle,
          cadence: target.cadence,
          promptTemplateId: target.promptTemplateId,
          active: target.active,
        }}
        cadencePresets={CADENCE_PRESETS}
        promptTemplates={promptTemplates}
        promptTemplatesAvailable={templatesAvailable}
      />

      <div className="mt-12 pt-8 border-t border-neutral-200">
        <h2 className="text-xs uppercase tracking-wide text-neutral-500 font-semibold mb-3">
          Cron-managed (read-only)
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <ReadOnlyRow label="Next due">
            {target.nextDueAt.toISOString().replace('T', ' ').slice(0, 19)}
          </ReadOnlyRow>
          <ReadOnlyRow label="Last run">
            {target.lastRunAt ? target.lastRunAt.toISOString().replace('T', ' ').slice(0, 19) : '—'}
          </ReadOnlyRow>
          <ReadOnlyRow label="Last status">{target.lastRunStatus ?? '—'}</ReadOnlyRow>
          <ReadOnlyRow label="Last failure reason">
            {target.lastRunFailureReason ?? '—'}
          </ReadOnlyRow>
          <ReadOnlyRow label="Created">
            {target.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
          </ReadOnlyRow>
          <ReadOnlyRow label="Updated">
            {target.updatedAt.toISOString().replace('T', ' ').slice(0, 19)}
          </ReadOnlyRow>
        </dl>
        <p className="text-xs text-neutral-500 mt-3">
          These fields are written by the cron sidecar (Phase 4) and the agent runtime (Phase 3).
        </p>
      </div>
    </div>
  )
}

function ReadOnlyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-mono text-xs text-neutral-800 break-all">{children}</dd>
    </>
  )
}

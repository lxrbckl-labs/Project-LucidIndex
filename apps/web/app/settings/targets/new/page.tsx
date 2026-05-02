/**
 * Settings → Targets → New (RSC) — rebuilt on shadcn (Phase 2).
 */

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { TargetForm } from '../_components/TargetForm'
import {
  CADENCE_PRESETS,
  hasAnyPromptTemplates,
  listPromptTemplateOptions,
} from '../_lib/targets-repo'

export const dynamic = 'force-dynamic'

export default async function NewTargetPage() {
  const [promptTemplates, templatesAvailable] = await Promise.all([
    listPromptTemplateOptions(),
    hasAnyPromptTemplates(),
  ])

  return (
    <div className="max-w-[640px] flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New target</h1>
      </div>

      <Button variant="ghost" size="sm" asChild className="self-start -ml-2">
        <Link href="/settings/targets">&larr; Back to targets</Link>
      </Button>

      <TargetForm
        mode="create"
        initial={{
          label: '',
          urlOrHandle: '',
          cadence: '',
          promptTemplateId: '',
          active: true,
        }}
        cadencePresets={CADENCE_PRESETS}
        promptTemplates={promptTemplates}
        promptTemplatesAvailable={templatesAvailable}
      />
    </div>
  )
}

/**
 * Settings → Targets → New (RSC) — rebuilt on shadcn (Phase 2).
 */

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
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
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 border border-input"
          aria-label="Back to targets"
          asChild
        >
          <Link href="/settings/targets">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Add Target</h1>
      </div>

      <Separator />

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

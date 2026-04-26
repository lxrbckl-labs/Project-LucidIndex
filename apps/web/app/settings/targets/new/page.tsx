/**
 * Settings → Targets → New (RSC).
 *
 * Loads the prompt-template options server-side, then hands off to the
 * client-only `<TargetForm>` for the interactive form. If no prompt
 * templates exist yet (#34 hasn't seeded the starters), the form renders
 * disabled with a friendly notice — no crash, no silent failure.
 */

import Link from 'next/link'
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
    <div className="max-w-[640px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        New target
      </h1>
      <div className="mt-6 mb-8 h-px w-full bg-neutral-200" />

      <Link
        href="/settings/targets"
        className="text-xs uppercase tracking-wide text-neutral-500 hover:text-black mb-6 inline-block"
      >
        &larr; Back to targets
      </Link>

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

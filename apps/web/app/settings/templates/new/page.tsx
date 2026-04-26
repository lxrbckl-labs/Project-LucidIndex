/**
 * Settings → Templates → New (RSC).
 *
 * Renders the create form. No server-side data load needed — a brand-new
 * template starts from defaults.
 */

import Link from 'next/link'
import { TemplateForm } from '../_components/TemplateForm'

export const dynamic = 'force-dynamic'

export default function NewTemplatePage() {
  return (
    <div className="max-w-[760px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        New template
      </h1>
      <div className="mt-6 mb-8 h-px w-full bg-neutral-200" />

      <Link
        href="/settings/templates"
        className="text-xs uppercase tracking-wide text-neutral-500 hover:text-black mb-6 inline-block"
      >
        &larr; Back to templates
      </Link>

      <TemplateForm
        mode="create"
        initial={{
          slug: '',
          body: '',
          crossSourceN: 3,
        }}
      />
    </div>
  )
}

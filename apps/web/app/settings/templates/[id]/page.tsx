/**
 * Settings → Templates → Edit (RSC).
 *
 * Loads the existing template server-side and hands off to `<TemplateForm>`
 * in `mode="edit"`. 404s if the id doesn't exist.
 *
 * Slug is locked on edit so existing target rows that reference this
 * template by id keep a stable display label, and so admins don't
 * accidentally rename a slug that's documented somewhere external. Admins
 * who really want a different slug can create a new template and re-point
 * the targets manually.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TemplateForm } from '../_components/TemplateForm'
import { getTemplate } from '../_lib/templates-repo'

export const dynamic = 'force-dynamic'

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const template = await getTemplate(id)
  if (!template) notFound()

  return (
    <div className="max-w-[760px]">
      <p className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Phase 2</p>
      <h1
        className="text-[clamp(2rem,5vw,3.5rem)] font-black tracking-tight leading-none text-black uppercase"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        Edit template
      </h1>
      <div className="mt-6 mb-8 h-px w-full bg-neutral-200" />

      <Link
        href="/settings/templates"
        className="text-xs uppercase tracking-wide text-neutral-500 hover:text-black mb-6 inline-block"
      >
        &larr; Back to templates
      </Link>

      <TemplateForm
        mode="edit"
        templateId={template.id}
        initial={{
          slug: template.slug,
          body: template.body,
          crossSourceN: template.crossSourceN,
        }}
        lockSlug
      />

      <div className="mt-12 pt-8 border-t border-neutral-200">
        <h2 className="text-xs uppercase tracking-wide text-neutral-500 font-semibold mb-3">
          Metadata (read-only)
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <ReadOnlyRow label="Created">
            {template.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
          </ReadOnlyRow>
          <ReadOnlyRow label="Updated">
            {template.updatedAt.toISOString().replace('T', ' ').slice(0, 19)}
          </ReadOnlyRow>
        </dl>
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

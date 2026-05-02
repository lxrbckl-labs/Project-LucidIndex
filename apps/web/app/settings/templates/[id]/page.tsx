/**
 * Settings → Templates → Edit (RSC) — rebuilt on shadcn (Phase 2).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TemplateForm } from '../_components/TemplateForm'
import { getTemplate } from '../_lib/templates-repo'

export const dynamic = 'force-dynamic'

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const template = await getTemplate(id)
  if (!template) notFound()

  return (
    <div className="max-w-[760px] flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit template</h1>
      </div>

      <Button variant="ghost" size="sm" asChild className="self-start -ml-2">
        <Link href="/settings/templates">&larr; Back to templates</Link>
      </Button>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">
            Metadata (read-only)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <ReadOnlyRow label="Created">
              {template.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
            </ReadOnlyRow>
            <ReadOnlyRow label="Updated">
              {template.updatedAt.toISOString().replace('T', ' ').slice(0, 19)}
            </ReadOnlyRow>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}

function ReadOnlyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs break-all">{children}</dd>
    </>
  )
}

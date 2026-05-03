/**
 * Settings → Templates → Edit (RSC) — rebuilt on shadcn (Phase 2).
 */

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { TemplateForm } from '../_components/TemplateForm'
import { getTemplate } from '../_lib/templates-repo'

export const dynamic = 'force-dynamic'

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const template = await getTemplate(id)
  if (!template) notFound()

  return (
    <div className="max-w-[760px] flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 border border-input"
          aria-label="Back to templates"
          asChild
        >
          <Link href="/settings/templates">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Edit Template</h1>
      </div>

      <Separator />

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

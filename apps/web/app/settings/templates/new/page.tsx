/**
 * Settings → Templates → New (RSC) — rebuilt on shadcn (Phase 2).
 */

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { TemplateForm } from '../_components/TemplateForm'

export const dynamic = 'force-dynamic'

export default function NewTemplatePage() {
  return (
    <div className="max-w-[760px] flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New template</h1>
      </div>

      <Button variant="ghost" size="sm" asChild className="self-start -ml-2">
        <Link href="/settings/templates">&larr; Back to templates</Link>
      </Button>

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

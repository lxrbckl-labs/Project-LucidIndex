/**
 * Settings → Templates → New (RSC) — rebuilt on shadcn (Phase 2).
 */

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TemplateForm } from '../_components/TemplateForm'

export const dynamic = 'force-dynamic'

export default function NewTemplatePage() {
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
        <h1 className="text-2xl font-bold tracking-tight">Add Template</h1>
      </div>

      <Separator />

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

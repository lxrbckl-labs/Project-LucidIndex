/**
 * Settings → Comparison Sources → New (RSC).
 */

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ComparisonSourceForm } from '../_components/ComparisonSourceForm'

export const dynamic = 'force-dynamic'

export default function NewComparisonSourcePage() {
  return (
    <div className="max-w-[640px] flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 border border-input"
          aria-label="Back to comparison sources"
          asChild
        >
          <Link href="/settings/comparison-sources">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">New comparison source</h1>
      </div>

      <ComparisonSourceForm
        mode="create"
        initial={{ name: '', baseUrl: '', isActive: true, notes: '' }}
      />
    </div>
  )
}

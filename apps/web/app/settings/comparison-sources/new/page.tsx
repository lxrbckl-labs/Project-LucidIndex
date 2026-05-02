/**
 * Settings → Comparison Sources → New (RSC).
 */

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ComparisonSourceForm } from '../_components/ComparisonSourceForm'

export const dynamic = 'force-dynamic'

export default function NewComparisonSourcePage() {
  return (
    <div className="max-w-[640px] flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New comparison source</h1>
      </div>

      <Button variant="ghost" size="sm" asChild className="self-start -ml-2">
        <Link href="/settings/comparison-sources">&larr; Back to comparison sources</Link>
      </Button>

      <ComparisonSourceForm
        mode="create"
        initial={{ name: '', baseUrl: '', isActive: true, notes: '' }}
      />
    </div>
  )
}

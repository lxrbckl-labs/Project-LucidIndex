/**
 * Settings → Comparison Sources → Edit (RSC).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ComparisonSourceForm } from '../_components/ComparisonSourceForm'
import { getComparisonSource } from '../_lib/comparison-sources-repo'

export const dynamic = 'force-dynamic'

export default async function EditComparisonSourcePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const source = await getComparisonSource(id)
  if (!source) notFound()

  return (
    <div className="max-w-[640px] flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit comparison source</h1>
      </div>

      <Button variant="ghost" size="sm" asChild className="self-start -ml-2">
        <Link href="/settings/comparison-sources">&larr; Back to comparison sources</Link>
      </Button>

      <ComparisonSourceForm
        mode="edit"
        sourceId={source.id}
        initial={{
          name: source.name,
          baseUrl: source.baseUrl,
          isActive: source.isActive,
          notes: source.notes ?? '',
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">
            Metadata (read-only)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Created</dt>
            <dd className="font-mono text-xs break-all">
              {source.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
            </dd>
            <dt className="text-muted-foreground">Updated</dt>
            <dd className="font-mono text-xs break-all">
              {source.updatedAt.toISOString().replace('T', ' ').slice(0, 19)}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}

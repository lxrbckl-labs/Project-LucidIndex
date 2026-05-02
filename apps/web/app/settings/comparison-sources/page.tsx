/**
 * Settings → Comparison Sources — list view (RSC).
 */

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ComparisonSourcesPanel } from './_components/ComparisonSourcesPanel'
import { listComparisonSources } from './_lib/comparison-sources-repo'

export const dynamic = 'force-dynamic'

export default async function ComparisonSourcesPage() {
  const sources = await listComparisonSources()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Comparison sources</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Canonical external sources agents consult when analyzing content (e.g. Wikipedia, AP,
            Reuters). Citations on articles reference entries from this list.
          </p>
        </div>
        <Button asChild>
          <Link href="/settings/comparison-sources/new">New source</Link>
        </Button>
      </div>

      {sources.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="text-center">
            <CardTitle>No comparison sources yet</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-center">
            <p className="text-sm text-muted-foreground">
              Add a source so agents know where to look for external context.
            </p>
          </CardContent>
          <CardFooter className="justify-center pb-8">
            <Button asChild>
              <Link href="/settings/comparison-sources/new">Add your first source</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Configured sources</CardTitle>
            <CardDescription>
              {sources.length} source{sources.length === 1 ? '' : 's'} configured.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ComparisonSourcesPanel rows={sources} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

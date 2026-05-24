/**
 * Settings → Comparison Sources — list view (RSC).
 */

import { AddComparisonSourceDialog } from './_components/AddComparisonSourceDialog'
import { ComparisonSourcesPanel } from './_components/ComparisonSourcesPanel'
import { listComparisonSources } from './_lib/comparison-sources-repo'

export const dynamic = 'force-dynamic'

export default async function ComparisonSourcesPage() {
  const sources = await listComparisonSources()

  return (
    <div className="flex flex-col gap-6">
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Comparison Sources</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Canonical external sources agents consult when analyzing content (e.g. Wikipedia, AP,
            Reuters). Citations on articles reference entries from this list.
          </p>
        </div>
        <AddComparisonSourceDialog />
      </div>

      {sources.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed py-12 text-center">
          <div>
            <p className="font-semibold">No comparison sources yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a source so agents know where to look for external context.
            </p>
          </div>
          <AddComparisonSourceDialog />
        </div>
      ) : (
        <ComparisonSourcesPanel rows={sources} />
      )}
    </div>
  )
}

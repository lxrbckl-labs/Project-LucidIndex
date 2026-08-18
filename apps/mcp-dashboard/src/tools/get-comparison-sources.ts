// `get_comparison_sources` — return the active comparison-source taxonomy.
//
// Read-only. Inactive sources (soft-archived via Settings →
// Comparison Sources) are excluded so agents can't attach citations
// referencing a deactivated source. Ordered by `name` for stable output.
//
// Citations on `articles` reference one of these by `name`. Combined
// with the strict-mode toggle, this tool is the agent's only safe way
// to learn which `source_name` values will pass `write_articles`
// validation.

import { db } from '@lucidindex/db/client'
import { comparisonSources } from '@lucidindex/db/schema'
import { asc, eq } from 'drizzle-orm'

export type ComparisonSource = {
  name: string
  base_url: string
  notes: string | null
}

export async function getComparisonSources(): Promise<{ sources: ComparisonSource[] }> {
  const rows = await db
    .select({
      name: comparisonSources.name,
      baseUrl: comparisonSources.baseUrl,
      notes: comparisonSources.notes,
    })
    .from(comparisonSources)
    .where(eq(comparisonSources.isActive, true))
    .orderBy(asc(comparisonSources.name))

  return {
    sources: rows.map((r) => ({
      name: r.name,
      base_url: r.baseUrl,
      notes: r.notes,
    })),
  }
}

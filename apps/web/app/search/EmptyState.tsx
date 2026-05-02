/**
 * EmptyState — shown on the search page when a query returned no results.
 */

import { Card, CardContent, CardTitle } from '@/components/ui/card'

type Props = {
  query: string
  includeArchived: boolean
}

export function EmptyState({ query, includeArchived }: Props) {
  return (
    <div className="flex justify-center" data-testid="search-empty">
      <Card className="max-w-xl w-full">
        <CardContent className="py-10 text-center">
          <CardTitle className="text-xl leading-snug">
            No results for &ldquo;{query}&rdquo;
          </CardTitle>
          <p className="mt-3 text-base text-muted-foreground leading-relaxed">
            {includeArchived
              ? 'Try a different query or fewer terms.'
              : 'Try a different query, fewer terms, or enable "Include archived" to broaden the search.'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

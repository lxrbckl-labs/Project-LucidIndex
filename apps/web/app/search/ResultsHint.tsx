/**
 * ResultsHint — shown on the search page when no query has been entered.
 */

import { Card, CardContent, CardTitle } from '@/components/ui/card'

export function ResultsHint() {
  return (
    <Card className="max-w-xl" data-testid="search-hint">
      <CardContent className="py-10">
        <CardTitle className="text-xl leading-snug">Type a query to begin.</CardTitle>
        <p className="mt-3 text-base text-muted-foreground leading-relaxed">
          Search runs over every article&apos;s title, summary, and deep-dive body.
        </p>
      </CardContent>
    </Card>
  )
}

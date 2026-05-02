/**
 * AuthenticatedEmptyState — what the admin sees on `/` when no articles
 * exist yet (#62 / Phase 4).
 *
 * Phase 4 rebuild: shadcn Card centered in the content area.
 */

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export function AuthenticatedEmptyState() {
  return (
    <div className="flex justify-center py-16">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>Nothing to read yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Configure a creator to start filing articles.
          </p>
        </CardContent>
        <CardFooter className="justify-center">
          <Button asChild>
            <a href="/settings/targets/new">Add a creator</a>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

/**
 * Global 404 — rendered by Next.js for any unmatched route in the app.
 *
 * Standalone (no TopNav) to avoid SidebarProvider-context dependencies
 * when this page is hit at a /settings/* path that didn't match a route.
 */

import { LayoutDashboard } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-24">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            LUCIDINDEX
          </p>
          <CardTitle className="text-3xl font-bold tracking-tight">404</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6">
          <p className="max-w-[360px] text-sm leading-relaxed text-muted-foreground">
            That page didn't make it to the press. It may have been moved, removed, or never
            existed.
          </p>
          <Button asChild>
            <Link href="/">
              Dashboard
              <LayoutDashboard className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}

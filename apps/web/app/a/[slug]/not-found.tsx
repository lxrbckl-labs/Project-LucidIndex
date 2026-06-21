/**
 * not-found.tsx — 404 for /a/[slug] (#70).
 *
 * Rendered by Next.js App Router automatically when `notFound()` is called
 * from page.tsx (missing slug OR hidden article). HTTP 404 is set by the
 * framework — no manual header needed.
 *
 * Styled to match the dashboard empty-state / invalid-topic card (see the
 * `!session && articles.length === 0` branch in app/page.tsx): TopNav + a
 * centered compact card with a normal-weight heading, muted tagline, and a
 * full-width primary Dashboard button. Keep the two in lockstep.
 *
 * Also covers the hide-article case (#69): a hidden article's loader returns
 * null → page.tsx calls notFound() → this page renders.
 */

import { LayoutDashboard } from 'lucide-react'
import Link from 'next/link'
import { TopNav } from '@/components/chrome/TopNav'
import { Button } from '@/components/ui/button'

export default function ArticleNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border bg-background p-6 text-center shadow-sm">
          <h2 className="text-xl font-semibold tracking-tight">Article not found</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            It may have been hidden or removed. Browse the latest issue from the dashboard.
          </p>
          <Button variant="default" asChild className="mt-2 w-full">
            <Link href="/">
              <LayoutDashboard className="mr-2 h-5 w-5 rotate-90" />
              Dashboard
            </Link>
          </Button>
        </div>
      </main>
    </div>
  )
}

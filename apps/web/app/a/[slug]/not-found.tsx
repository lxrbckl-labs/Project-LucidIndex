/**
 * not-found.tsx — editorial 404 page for /a/[slug] (#70).
 *
 * Phase 5 rebuild: shadcn `<Card>` centered with title "Article not found",
 * short body copy, and a `<Button asChild>` with `<Link href="/">`.
 *
 * Rendered by Next.js App Router automatically when `notFound()` is
 * called from page.tsx (missing slug OR hidden article). HTTP 404 is
 * set by the framework — no manual header needed.
 *
 * Design rules:
 *   - Same chrome as the article page (TopNav + Wordmark + hairline rule).
 *   - Magazine tone: editorial copy, NOT a stack-trace style error page.
 *   - Centered column, generous vertical whitespace.
 *
 * This surface also covers the hide-article case (#69): when an article
 * is hidden, the loader returns null → page.tsx calls notFound() →
 * this page renders. The hide-action itself ships in a separate PR.
 */

import Link from 'next/link'
import { TopNav } from '@/components/chrome/TopNav'
import { Wordmark } from '@/components/chrome/Wordmark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ArticleNotFound() {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="px-6 pt-12 pb-24 md:px-18">
        <div className="py-6 md:py-10">
          <Wordmark />
        </div>

        {/* Hairline rule — matches the article page separator. */}
        <div className="mt-6 mb-12 h-px w-full bg-border" />

        {/* Centered card — editorial 404 body. */}
        <div className="mx-auto w-full max-w-md">
          <div className="flex flex-col items-center py-16">
            <Card className="w-full text-center">
              <CardHeader>
                <CardTitle className="font-display text-2xl font-bold uppercase tracking-tight text-foreground">
                  Article not found
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-6">
                <p className="max-w-[400px] text-base leading-relaxed text-muted-foreground">
                  It may have been hidden or removed. Browse the latest issue:
                </p>
                <Button asChild variant="outline">
                  <Link href="/">Back to dashboard</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}

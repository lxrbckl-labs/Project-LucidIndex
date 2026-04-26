/**
 * not-found.tsx — editorial 404 page for /a/[slug] (#70).
 *
 * Rendered by Next.js App Router automatically when `notFound()` is
 * called from page.tsx (missing slug OR hidden article). HTTP 404 is
 * set by the framework — no manual header needed.
 *
 * Design rules:
 *   - Same chrome as the article page (TopNav + Wordmark + hairline rule).
 *   - Magazine tone: editorial copy, NOT a stack-trace style error page.
 *   - Centered column, generous vertical whitespace.
 *   - A single hairline-bordered text link → "/" (Back to LUCIDINDEX).
 *
 * This surface also covers the hide-article case (#69): when an article
 * is hidden, the loader returns null → page.tsx calls notFound() →
 * this page renders. The hide-action itself ships in a separate PR.
 */

import Link from 'next/link'
import { TopNav } from '@/components/chrome/TopNav'
import { Wordmark } from '@/components/chrome/Wordmark'

export default function ArticleNotFound() {
  return (
    <div className="min-h-screen bg-paper">
      <TopNav />

      <main className="px-6 pt-12 pb-24 md:px-18">
        <div className="py-6 md:py-10">
          <Wordmark />
        </div>

        {/* Hairline rule — matches the article page separator. */}
        <div className="mt-6 mb-12 h-px w-full bg-[var(--color-card-border)]" />

        {/* Editorial 404 body — single column, centered. */}
        <div className="mx-auto w-full max-w-[820px]">
          <div className="flex flex-col items-center py-24 text-center">
            {/* Primary message — quiet magazine tone, no large "404" heading. */}
            <p
              className="font-display text-[length:var(--text-display-md)] font-bold uppercase tracking-tight text-ink"
              style={{ letterSpacing: '-0.01em' }}
            >
              This article isn't available.
            </p>

            {/* Subtitle — one explanatory line in muted body type. */}
            <p className="mt-6 max-w-[480px] text-[length:var(--text-body)] leading-relaxed text-[var(--color-muted-700)]">
              It may have been hidden or removed. Browse the latest issue:
            </p>

            {/* CTA — hairline-bordered text link back to the magazine root. */}
            <Link
              href="/"
              className="mt-10 inline-flex items-center border border-[var(--color-card-border)] px-6 py-3 text-[var(--text-meta)] uppercase tracking-[0.08em] text-ink no-underline transition-colors duration-150 hover:border-ink"
              style={{ borderRadius: 'var(--radius-pill)' }}
            >
              Back to LUCIDINDEX
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

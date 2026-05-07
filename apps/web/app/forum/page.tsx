/**
 * Forum — placeholder for the upcoming feature.
 *
 * Renders the standard TopNav so the chrome (wordmark, search, settings,
 * forum trigger on dashboard) stays consistent across the app. Body is
 * intentionally empty — phases will fill it in.
 */

import type { Metadata } from 'next'
import { TopNav } from '@/components/chrome/TopNav'
import { ForumGate } from './_components/ForumGate'

export const metadata: Metadata = {
  title: 'Forum — LucidIndex',
}

export default function ForumPage() {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="px-4 pt-4 pb-16">
        <ForumGate>
          {/* Phase B placeholder — fills with real forum content in later phases. */}
          <div className="flex flex-col gap-4 max-w-3xl mx-auto">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-5/6 rounded bg-muted" />
            <div className="h-4 w-4/6 rounded bg-muted" />
            <div className="mt-6 h-32 w-full rounded-lg bg-muted" />
            <div className="h-32 w-full rounded-lg bg-muted" />
          </div>
        </ForumGate>
      </main>
    </div>
  )
}

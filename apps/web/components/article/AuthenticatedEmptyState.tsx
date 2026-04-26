/**
 * AuthenticatedEmptyState — what the admin sees on `/` when the
 * dashboard has no articles to show yet (#62).
 *
 * Different from the public-visitor empty state on `app/page.tsx`
 * (which intentionally does NOT pitch Settings — admin surface is
 * private). This component DOES point the admin at Settings → Targets
 * because that's where they configure their first creator.
 *
 * Visual rules (per Visual Identity.md):
 *   - Wordmark stays at the top of the page; that's owned by the
 *     dashboard layout, not this component.
 *   - Muted-copy block here is centered in the dashboard content area
 *     with generous editorial whitespace.
 *   - The "Settings → Targets" affordance is a textual link with a
 *     hairline underline on hover, not a button. Magazine vibe.
 */

import Link from 'next/link'

export function AuthenticatedEmptyState() {
  return (
    <section className="mx-auto max-w-[640px] py-24 text-center">
      <p className="text-2xl font-semibold leading-snug text-ink">Nothing here yet.</p>
      <p className="mt-4 text-base leading-relaxed text-[var(--color-muted-700)]">
        Configure your first creator in{' '}
        <Link href="/settings/targets" className="text-ink underline-offset-4 hover:underline">
          Settings &rarr; Targets
        </Link>{' '}
        to start filing articles.
      </p>
    </section>
  )
}

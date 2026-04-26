/**
 * TopNav — thin top bar above the LUCIDINDEX wordmark (#55).
 *
 * Reference: <vault>/Projects/Project-LucidIndex/Visual Identity.md
 * (the "Page chrome" section is binding) and `Design/main.jpg`.
 *
 * Anatomy:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │                                          Settings   Account  │   ← thin row,
 *   │                                                              │      hairline bottom border,
 *   │                                                              │      links right-aligned
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Hard rules from the spec:
 *   - Magazine vibe — text links, no buttons, no rounded corners.
 *   - Hairline bottom border (`--color-card-border`).
 *   - Right-aligned link group; nothing on the left for v0.1.
 *   - Authenticated-admin-only — the public empty state on `/` stays
 *     deliberately clean (no nav). The `app/page.tsx` server component
 *     gates this component on the session result.
 *
 * Server component — pure render, no client interactivity needed. The
 * `Link` underline-on-hover affordance is owned by the global stylesheet
 * via Tailwind's `hover:underline` utility.
 */

import Link from 'next/link'
import { SearchInput } from './SearchInput'

export function TopNav() {
  return (
    <nav
      aria-label="Primary"
      className="flex items-center justify-end gap-8 border-b border-[var(--color-card-border)] px-6 py-3 md:px-18"
    >
      {/* Search lives on the left of the right-aligned cluster (#73). */}
      <SearchInput />
      {/* Phase 8 #85 — focus state inherits the global :focus-visible
          rule (1px ink outline + 2px offset) from globals.css. No
          rounded-blue browser default; magazine vibe holds. */}
      <Link
        href="/settings"
        className="text-[var(--text-meta)] uppercase tracking-[0.12em] text-[var(--color-muted-700)] transition-colors hover:text-ink hover:underline underline-offset-4"
      >
        Settings
      </Link>
      <Link
        href="/settings/account"
        className="text-[var(--text-meta)] uppercase tracking-[0.12em] text-[var(--color-muted-700)] transition-colors hover:text-ink hover:underline underline-offset-4"
      >
        Account
      </Link>
    </nav>
  )
}

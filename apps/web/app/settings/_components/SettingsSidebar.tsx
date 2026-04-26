/**
 * Settings sidebar — links to every sub-panel.
 *
 * Editorial styling consistent with the public landing (`app/page.tsx`):
 * heavy condensed sans wordmark, hairline rules, restrained palette.
 * Full Visual Identity treatment lands in Phase 5 (#56) — this is a
 * functional placeholder that won't look out of place in the meantime.
 *
 * Marked as a client component so we can highlight the active sub-panel
 * with `usePathname()`. Active styling is minimal — a left-edge bar and
 * boldface — but it's enough to give a sense of place without dragging
 * in a router-aware nav primitive.
 */

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SECTIONS: ReadonlyArray<{ href: string; label: string; phase: string }> = [
  { href: '/settings', label: 'Overview', phase: '' },
  { href: '/settings/account', label: 'Account', phase: 'Phase 2' },
  { href: '/settings/targets', label: 'Targets', phase: 'Phase 2' },
  { href: '/settings/badges', label: 'Badges', phase: 'Phase 2' },
  { href: '/settings/templates', label: 'Templates', phase: 'Phase 2' },
  { href: '/settings/agent-tokens', label: 'Agent tokens', phase: 'Phase 2' },
  { href: '/settings/off-site-backup', label: 'Off-site backup', phase: 'Phase 2' },
  { href: '/settings/system', label: 'System', phase: 'Phase 7' },
  { href: '/settings/hidden-articles', label: 'Hidden articles', phase: 'Phase 7' },
]

export function SettingsSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 shrink-0 border-r border-neutral-200 px-6 py-12 md:py-16">
      <Link
        href="/settings"
        className="block text-2xl font-black tracking-tight uppercase text-black hover:opacity-70"
        style={{ fontStretch: 'condensed', letterSpacing: '-0.02em' }}
      >
        SETTINGS
      </Link>
      <div className="mt-6 mb-8 h-px w-full bg-neutral-200" />
      <nav>
        <ul className="space-y-1">
          {SECTIONS.map((section) => {
            // Treat /settings as active only on an exact match so it doesn't
            // light up for every sub-panel.
            const isActive =
              section.href === '/settings'
                ? pathname === '/settings'
                : pathname === section.href || pathname.startsWith(`${section.href}/`)
            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className={`block py-2 px-2 -mx-2 border-l-2 transition-colors ${
                    isActive
                      ? 'border-black font-semibold text-black'
                      : 'border-transparent text-neutral-600 hover:text-black'
                  }`}
                >
                  <span className="block text-sm">{section.label}</span>
                  {section.phase && (
                    <span className="block text-xs text-neutral-400 mt-0.5">{section.phase}</span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="mt-12 pt-6 border-t border-neutral-200">
        <LogoutButton />
      </div>
    </aside>
  )
}

function LogoutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' })
        window.location.href = '/'
      }}
      className="text-xs uppercase tracking-wide text-neutral-500 hover:text-black"
    >
      Sign out
    </button>
  )
}

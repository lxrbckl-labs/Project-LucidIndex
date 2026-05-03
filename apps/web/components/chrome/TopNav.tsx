'use client'

/**
 * TopNav — shadcn-aesthetic app header (Phase 3 rebuild).
 *
 * Layout:
 *   <header bg-background border-b>
 *     [Back button]       ← far left, only on /a/* article pages
 *     [Wordmark]          ← left
 *     [SearchInput]       ← right cluster
 *     [Settings icon]     ← right cluster (ghost button)
 *     [User dropdown]     ← right cluster (account / logout)
 *
 * Logout calls /api/auth/logout via fetch (POST) then reloads to /
 * so the server session is cleared before any redirect.
 *
 * Made a client component (minimal, `use client`) so the logout
 * handler and DropdownMenu work correctly. Pure server rendering
 * isn't required — this is in every authenticated layout.
 */

import { LayoutDashboard, Settings } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { EscapeToBack } from '@/components/article/EscapeToBack'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { TypeaheadSearch } from './TypeaheadSearch'

export function TopNav() {
  const pathname = usePathname()

  const isArticlePage = pathname.startsWith('/a/')
  const isSettingsPage = pathname.startsWith('/settings')

  return (
    <header className="sticky top-0 z-50 border-b bg-background/70 backdrop-blur-lg supports-[backdrop-filter]:bg-background/50">
      <div className="flex items-center justify-between p-4">
        {/* Left cluster: sidebar collapse (settings only) + back button (article only) + wordmark */}
        <div className="flex items-center gap-2">
          {isSettingsPage && <SidebarTrigger className="h-9 w-9 border border-input" />}
          {isArticlePage && <EscapeToBack />}
          <Link
            href="/"
            onClick={(e) => {
              if (pathname === '/') {
                e.preventDefault()
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }
            }}
            className="text-xl font-semibold uppercase tracking-wider text-foreground hover:opacity-80 transition-opacity"
          >
            LUCIDINDEX
          </Link>
        </div>

        {/* Right cluster: search + favorites + settings/dashboard toggle */}
        <div className="flex items-center gap-2">
          <TypeaheadSearch />

          {isSettingsPage ? (
            <Button variant="ghost" size="icon" className="h-9 w-9 border border-input" asChild>
              <Link href="/" aria-label="Dashboard">
                <LayoutDashboard className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="h-9 w-9 border border-input" asChild>
              <Link href="/settings" aria-label="Settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}

'use client'

/**
 * TopNav — shadcn-aesthetic app header (Phase 3 rebuild).
 *
 * Layout:
 *   <header bg-background border-b>
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

import { Settings, User } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TypeaheadSearch } from './TypeaheadSearch'

export function TopNav() {
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }

  return (
    <header className="bg-background border-b">
      <div className="flex items-center justify-between px-4 py-3 md:px-6 lg:px-8">
        {/* Brand mark — left side. Not an <h1> here; the page content
            area owns the <h1> via the standalone <Wordmark> component. */}
        <Link
          href="/"
          className="text-xl font-semibold uppercase tracking-wider text-foreground hover:opacity-80 transition-opacity"
        >
          LUCIDINDEX
        </Link>

        {/* Right cluster: search + settings + user menu */}
        <div className="flex items-center gap-2">
          <TypeaheadSearch />

          <Button variant="ghost" size="icon" className="h-9 w-9 border border-input" asChild>
            <Link href="/settings" aria-label="Settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 border border-input"
                aria-label="Account menu"
              >
                <User className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/settings/account">Account</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleLogout}
                className="text-destructive focus:text-destructive"
              >
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

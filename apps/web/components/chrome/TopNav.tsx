'use client'

/**
 * TopNav — shadcn-aesthetic app header (Phase 3 rebuild).
 *
 * Layout:
 *   <header bg-background>
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

import { LayoutDashboard, MessagesSquare, Settings } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { EscapeToBack } from '@/components/article/EscapeToBack'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ThemeToggle } from './ThemeToggle'
import { TypeaheadSearch } from './TypeaheadSearch'

export function TopNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const isArticlePage = pathname.startsWith('/a/')
  const isCreatorPage = pathname.startsWith('/c/')
  const isSettingsPage = pathname.startsWith('/settings')
  const isForumPage = pathname.startsWith('/forum')
  const isTopicFocus = pathname === '/' && Boolean(searchParams.get('badge'))
  const showBack = isArticlePage || isCreatorPage || isTopicFocus
  const isDashboard = pathname === '/' && !isTopicFocus

  return (
    <header className="sticky top-0 z-50 bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/50">
      <div className="grid grid-cols-3 items-center p-4">
        {/* Left cluster: sidebar collapse (settings only) + back button (article/topic-focus) + Forum (dashboard) / Dashboard (forum) */}
        <div className="flex items-center justify-start gap-2">
          {isSettingsPage && (
            <SidebarTrigger className="h-9 w-9 border border-input bg-background" />
          )}
          {showBack && <EscapeToBack />}
          {isDashboard && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 border border-input bg-background"
                  asChild
                >
                  <Link href="/forum" aria-label="Forum">
                    <MessagesSquare className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Forum</TooltipContent>
            </Tooltip>
          )}
          {isForumPage && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 border border-input bg-background"
                  asChild
                >
                  <Link href="/" aria-label="Dashboard">
                    <LayoutDashboard className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dashboard</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Center: wordmark */}
        <div className="flex items-center justify-center">
          <Link
            href="/"
            onClick={(e) => {
              if (pathname === '/' && !searchParams.get('badge')) {
                e.preventDefault()
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }
            }}
            className="text-xl font-semibold uppercase tracking-wider text-foreground hover:opacity-80 transition-opacity"
          >
            LUCIDINDEX
          </Link>
        </div>

        {/* Right cluster: search + theme toggle + settings/dashboard toggle */}
        <div className="flex items-center justify-end gap-2">
          <TypeaheadSearch />

          <ThemeToggle />

          {isSettingsPage ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 border border-input bg-background"
                  asChild
                >
                  <Link href="/" aria-label="Dashboard">
                    <LayoutDashboard className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dashboard</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 border border-input bg-background"
                  asChild
                >
                  <Link href="/settings" aria-label="Settings">
                    <Settings className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  )
}

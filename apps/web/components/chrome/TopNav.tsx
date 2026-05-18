'use client'

/**
 * TopNav — shadcn-aesthetic app header (Phase 3 rebuild).
 *
 * Layout:
 *   <header bg-background>
 *     [SidebarTrigger]    ← far left, on settings + authenticated forum
 *     [Forum/Dashboard]   ← left cluster on every page (Dashboard on /forum)
 *     [Back button]       ← left cluster, article/creator/topic-focus only
 *     [Wordmark]          ← center
 *     [SearchInput]       ← right cluster
 *     [ThemeToggle]       ← right cluster
 *     [Settings/Dashboard]← right cluster (Dashboard icon on /settings)
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
import { useContext } from 'react'
import { EscapeToBack } from '@/components/article/EscapeToBack'
import { Button } from '@/components/ui/button'
import { SidebarContext, SidebarTrigger } from '@/components/ui/sidebar'
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
  const isForumPostPage = pathname.startsWith('/forum/posts/')
  const isTopicFocus = pathname === '/' && Boolean(searchParams.get('badge'))
  const showBack = isArticlePage || isCreatorPage || isTopicFocus || isForumPostPage
  // SidebarTrigger requires a SidebarProvider in the tree (its
  // `useSidebar` hook throws otherwise). The forum layout only mounts
  // the provider for authenticated users; on the gate there's no
  // sidebar at all. Reading the context directly lets us render the
  // trigger iff we're actually inside a shell.
  const hasSidebarShell = useContext(SidebarContext) !== null

  return (
    <header className="sticky top-0 z-50 bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/50">
      <div className="grid grid-cols-3 items-center p-4">
        {/* Left cluster. Order from left to right:
              1. SidebarTrigger — settings / forum shell only.
              2. Forum button — on every page EXCEPT /forum (you can't
                 jump from Forum to itself; the Dashboard slot moved to
                 the right cluster).
              3. EscapeToBack — article / creator / topic-focus / forum
                 post pages. */}
        <div className="flex items-center justify-start gap-2">
          {(isSettingsPage || isForumPage) && hasSidebarShell && (
            <SidebarTrigger className="h-9 w-9 shrink-0 border border-input bg-background" />
          )}
          {!isForumPage && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" asChild>
                  <Link href="/forum" aria-label="Forum">
                    <MessagesSquare className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Forum</TooltipContent>
            </Tooltip>
          )}
          {showBack && <EscapeToBack />}
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

        {/* Right cluster: search + theme toggle + Dashboard + Settings.
            Dashboard sits to the left of Settings. Each nav button is
            suppressed on its own surface (you can't jump from
            /settings to /settings, or from / to /). */}
        <div className="flex items-center justify-end gap-2">
          <TypeaheadSearch />

          <ThemeToggle />

          {pathname !== '/' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" asChild>
                  <Link href="/" aria-label="Dashboard">
                    <LayoutDashboard className="h-4 w-4 rotate-90" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dashboard</TooltipContent>
            </Tooltip>
          )}

          {!isSettingsPage && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" asChild>
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

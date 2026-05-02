'use client'

/**
 * SettingsInsetHeader — sticky header bar rendered inside <SidebarInset>.
 *
 * Matches the shadcn dashboard-01 block header pattern:
 *   [SidebarTrigger] | [separator] | [breadcrumb]     [logout dropdown]
 *
 * The breadcrumb is derived client-side from `usePathname()` so it updates
 * on navigation without a full-page reload.
 */

import { ChevronRight, ChevronsUpDown, LogOut, User } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

/** Map from path segment → human-readable label for the breadcrumb. */
const PATH_LABELS: Record<string, string> = {
  account: 'Account',
  targets: 'Targets',
  'comparison-sources': 'Comparison Sources',
  badges: 'Badges',
  templates: 'Templates',
  'agent-tokens': 'Agent Tokens',
  'off-site-backup': 'Off-site Backup',
  system: 'System',
  'hidden-articles': 'Hidden Articles',
}

function useCurrentPageLabel(): string | null {
  const pathname = usePathname()
  // pathname is /settings, /settings/targets, /settings/targets/new, etc.
  const parts = pathname.split('/').filter(Boolean) // ['settings'], ['settings', 'targets', ...]
  if (parts.length < 2) return null
  const segment = parts[1] ?? '' // e.g. 'targets', 'comparison-sources'
  return PATH_LABELS[segment] ?? null
}

export function SettingsInsetHeader() {
  const router = useRouter()
  const pageLabel = useCurrentPageLabel()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 sticky top-0 z-10 bg-background">
      {/* Left cluster: trigger + separator + breadcrumb */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="h-4" />

        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {pageLabel ? (
                <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
              ) : (
                <BreadcrumbPage>Settings</BreadcrumbPage>
              )}
            </BreadcrumbItem>

            {pageLabel && (
              <>
                <BreadcrumbSeparator>
                  <ChevronRight className="h-3.5 w-3.5" />
                </BreadcrumbSeparator>
                <BreadcrumbItem>
                  <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Right cluster: account/logout dropdown */}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-sm font-normal"
              aria-label="Account menu"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Admin</span>
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onSelect={handleLogout}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/">← Dashboard</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

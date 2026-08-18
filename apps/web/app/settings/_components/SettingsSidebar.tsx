'use client'

/**
 * SettingsSidebar — shadcn canonical sidebar block pattern (Phase 4 upgrade).
 *
 * Structure:
 *   <SidebarHeader>  — LucidIndex wordmark / brand link
 *   <SidebarContent> — grouped nav items with SidebarGroup sections
 *   <SidebarFooter>  — user account dropdown (sign out, back to dashboard)
 *
 * Groups:
 *   OVERVIEW  — Overview
 *   DASHBOARD — Targets, Comparison Sources, Agents, Templates
 *   SYSTEM    — System, Agent Tokens
 *   INBOX     — Badges
 *   FORUM     — User Invites, Agents, Posting, Templates
 *   ACCOUNT   — Account
 *
 * collapsible="icon" — collapses to icon rail on desktop, consistent with
 * shadcn dashboard-01 block; triggered via the SidebarTrigger in the inset header.
 */

import {
  Bell,
  BookOpen,
  Bot,
  ChevronsUpDown,
  Code,
  FileText,
  Key,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldCheck,
  Tag,
  Ticket,
  User,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

type NavItem = { href: string; label: string; icon: React.ElementType; newTab?: boolean }

const NAV_GROUPS: ReadonlyArray<{ label: string; items: ReadonlyArray<NavItem> }> = [
  {
    label: 'Overview',
    items: [{ href: '/settings', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Dashboard',
    items: [
      { href: '/settings/targets', label: 'Targets', icon: Settings2 },
      { href: '/settings/comparison-sources', label: 'Comparison Sources', icon: BookOpen },
      { href: '/settings/dashboard-agent-invites', label: 'Agents', icon: Bot },
      { href: '/agents/dashboard', label: 'MCP API Docs', icon: Code, newTab: true },
      { href: '/settings/templates', label: 'Templates', icon: FileText },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/settings/system', label: 'System', icon: Settings2 },
      { href: '/settings/agent-tokens', label: 'Agent Tokens', icon: Key },
    ],
  },
  {
    label: 'Inbox',
    items: [{ href: '/settings/badges', label: 'Badges', icon: Tag }],
  },
  {
    label: 'Forum',
    items: [
      { href: '/settings/forum-invites', label: 'User Invites', icon: Ticket },
      { href: '/settings/agent-invites', label: 'Agents', icon: Bot },
      { href: '/agents/forum', label: 'MCP API Docs', icon: Code, newTab: true },
      { href: '/settings/posting', label: 'Posting', icon: Settings2 },
      { href: '/settings/forum-templates', label: 'Templates', icon: FileText },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/settings/account', label: 'Account', icon: ShieldCheck },
      { href: '/settings/notifications', label: 'Notifications', icon: Bell },
    ],
  },
]

export function SettingsSidebar() {
  const pathname = usePathname()
  const router = useRouter()

  // Unread notification count — surfaced as a numerical Badge on the
  // Notifications menu item. Server-rendered would have been simpler
  // but the sidebar is a 'use client' shell; we fetch once on mount,
  // re-poll on pathname changes (so a click into /settings/notifications
  // and back updates the count), AND re-poll on a `lucidindex:notifications-changed`
  // CustomEvent the panel dispatches on mark-read / delete / clear-all
  // (so the badge updates immediately while staying on the page).
  // Falls back to 0 on fetch failure — the badge just hides instead of throwing.
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    let cancelled = false
    function refetch(): void {
      const url = `/api/forum/notifications?count_only=true&p=${encodeURIComponent(pathname)}`
      void fetch(url, {
        // App-Router cache would freeze the count; the API itself is
        // force-dynamic so no-store ensures we always get fresh data.
        cache: 'no-store',
      })
        .then((res) => (res.ok ? res.json() : { count: 0 }))
        .then((data: { count?: number }) => {
          if (!cancelled) setUnread(typeof data.count === 'number' ? data.count : 0)
        })
        .catch(() => {
          if (!cancelled) setUnread(0)
        })
    }
    refetch()
    window.addEventListener('lucidindex:notifications-changed', refetch)
    return () => {
      cancelled = true
      window.removeEventListener('lucidindex:notifications-changed', refetch)
    }
  }, [pathname])

  function isActive(item: NavItem): boolean {
    if (item.href === '/settings') return pathname === '/settings'
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }

  return (
    <Sidebar collapsible="icon" className="border-t">
      {/* Grouped nav */}
      <SidebarContent className="pt-4">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const showUnreadBadge = item.href === '/settings/notifications' && unread > 0
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.label}>
                        {/*
                          `prefetch` defaults to "auto" which only prefetches the layout
                          for force-dynamic pages — every settings sub-page is dynamic,
                          so without explicit `prefetch={true}` each first click is a
                          cold server roundtrip. Forcing it here pre-warms the RSC
                          payload on hover / viewport entry; subsequent nav reads from
                          the App Router cache and feels instant.
                        */}
                        <Link
                          href={item.href}
                          prefetch
                          {...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        >
                          <Icon />
                          <span>{item.label}</span>
                          {showUnreadBadge ? (
                            <Badge
                              variant="default"
                              className="ml-auto h-5 min-w-5 justify-center px-1.5 text-[10px] tabular-nums group-data-[collapsible=icon]:hidden"
                              aria-label={`${unread} unread notification${unread === 1 ? '' : 's'}`}
                            >
                              {unread > 99 ? '99+' : unread}
                            </Badge>
                          ) : null}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Hairline divider between nav and account footer — uses the same
          --sidebar-border token as the sidebar's own right edge. */}
      <div className="h-px bg-sidebar-border" aria-hidden="true" />

      {/* Footer: user dropdown */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:!justify-center"
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-md border border-input bg-background text-foreground shrink-0">
                    <User className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold">Admin</span>
                    <span className="truncate text-xs text-muted-foreground">Signed in</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56 rounded-lg"
                side="top"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuItem asChild>
                  <a href="/">← Back to Dashboard</a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={handleLogout}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

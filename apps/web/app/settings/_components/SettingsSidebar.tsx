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
 *   AGENTS    — Targets, Comparison Sources, Templates
 *   SYSTEM    — System, Agent Tokens
 *   INBOX     — Badges
 *   ACCOUNT   — Account
 *
 * collapsible="icon" — collapses to icon rail on desktop, consistent with
 * shadcn dashboard-01 block; triggered via the SidebarTrigger in the inset header.
 */

import {
  BookOpen,
  ChevronsUpDown,
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

type NavItem = { href: string; label: string; icon: React.ElementType }

const NAV_GROUPS: ReadonlyArray<{ label: string; items: ReadonlyArray<NavItem> }> = [
  {
    label: 'Overview',
    items: [{ href: '/settings', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Agents',
    items: [
      { href: '/settings/targets', label: 'Targets', icon: Settings2 },
      { href: '/settings/comparison-sources', label: 'Comparison Sources', icon: BookOpen },
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
    items: [{ href: '/settings/forum-invites', label: 'Forum Invites', icon: Ticket }],
  },
  {
    label: 'Account',
    items: [{ href: '/settings/account', label: 'Account', icon: ShieldCheck }],
  },
]

export function SettingsSidebar() {
  const pathname = usePathname()
  const router = useRouter()

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
    <Sidebar collapsible="icon">
      {/* Grouped nav */}
      <SidebarContent className="pt-4">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.label}>
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.label}</span>
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

      {/* Footer: user dropdown */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted">
                    <User className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Admin</span>
                    <span className="truncate text-xs text-muted-foreground">Signed in</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
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

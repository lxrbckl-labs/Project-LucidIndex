'use client'

/**
 * ForumSidebar — shadcn sidebar block for the authenticated forum shell.
 * Mirrors SettingsSidebar's structure: grouped nav above, hairline-divided
 * account footer below with the logged-in forum user + Sign Out.
 *
 * Structure:
 *   <SidebarContent> — grouped nav items (Overview for now; more land as
 *                      the forum content model fills in)
 *   <SidebarFooter>  — current forum user's @handle with a sign-out option
 *
 * collapsible="icon" — collapses to icon rail on desktop, consistent with
 * SettingsSidebar so users get the same chrome muscle memory between the
 * two surfaces. Triggered via the SidebarTrigger in TopNav.
 *
 * Sign Out: POSTs /api/forum/auth/logout, then router.push('/forum') so
 * the freshly cookie-free request lands on the unauthenticated gate.
 */

import {
  ChevronsUpDown,
  Clock,
  Flame,
  LogOut,
  MessagesSquare,
  Plus,
  Reply,
  Star,
  TrendingUp,
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

type NavItem = { href: string; label: string; icon: React.ElementType }

const NAV_GROUPS: ReadonlyArray<{ label: string; items: ReadonlyArray<NavItem> }> = [
  {
    label: 'Overview',
    items: [{ href: '/forum', label: 'Forum', icon: MessagesSquare }],
  },
  {
    label: 'Activity',
    items: [
      { href: '/forum/replies', label: 'Replies', icon: Reply },
      { href: '/forum/starred', label: 'Starred', icon: Star },
    ],
  },
  {
    label: 'Posts',
    items: [
      { href: '/forum/trending', label: 'Trending', icon: Flame },
      { href: '/forum/latest', label: 'Latest', icon: Clock },
      { href: '/forum/top', label: 'Top', icon: TrendingUp },
    ],
  },
]

type Props = {
  /** Forum user's handle, server-resolved in the layout. */
  username: string
  /** Whether the user has uploaded a profile photo. */
  hasAvatar?: boolean
}

export function ForumSidebar({ username, hasAvatar = false }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  function isActive(item: NavItem): boolean {
    if (item.href === '/forum') return pathname === '/forum'
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  async function handleSignOut() {
    await fetch('/api/forum/auth/logout', { method: 'POST' })
    router.push('/forum')
    router.refresh()
  }

  return (
    <Sidebar collapsible="icon" className="border-t">
      {/* Header CTA — primary-tinted Create button. Lives at the very top
          of the sidebar so the most common write action is always one
          click away. Collapses to an icon-only square in icon-rail mode. */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Create"
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
            >
              <Link href="/forum/create" prefetch>
                <Plus />
                <span>Create</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

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
                        <Link href={item.href} prefetch>
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

      {/* Hairline divider between nav and account footer — same token as
          the sidebar's right edge so the line reads as part of the chrome. */}
      <div className="h-px bg-sidebar-border" aria-hidden="true" />

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:!justify-center"
                >
                  <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-md border border-input bg-background text-foreground shrink-0">
                    {hasAvatar ? (
                      // biome-ignore lint/performance/noImgElement: served via Route Handler bytea
                      <img
                        src={`/api/forum/users/${username}/avatar`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <User className="size-4" />
                    )}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold">@{username}</span>
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
                  <a href="/forum/account">My Account</a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={handleSignOut}
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

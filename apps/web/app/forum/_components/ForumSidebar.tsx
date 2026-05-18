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
  FileEdit,
  Flame,
  LogOut,
  MessagesSquare,
  Plus,
  Reply,
  Star,
  Trash2,
  TrendingUp,
  User,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import React, { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  SidebarMenuAction,
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

/**
 * Sidebar-shaped projection of a draft. ISO strings on the wire so the
 * client boundary doesn't need a Date serializer.
 */
export type SidebarDraft = {
  id: string
  title: string
  updatedAt: string
}

type Props = {
  /** Forum user's handle, server-resolved in the layout. */
  username: string
  /** Whether the user has uploaded a profile photo. */
  hasAvatar?: boolean
  /**
   * Draft summaries for the current user, server-fetched in the layout.
   * Sorted most-recently-updated first. Empty array → the Drafts group
   * is omitted entirely (no empty header).
   */
  drafts?: SidebarDraft[]
}

export function ForumSidebar({ username, hasAvatar = false, drafts = [] }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Single-draft delete state lives at the sidebar level so the
  // AlertDialog has one mount point per click — opening on the row's
  // trash icon, confirm-or-cancel, close.
  const [pendingDelete, setPendingDelete] = useState<SidebarDraft | null>(null)
  const [deleting, setDeleting] = useState(false)

  function isActive(item: NavItem): boolean {
    if (item.href === '/forum') return pathname === '/forum'
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  function isDraftActive(draftId: string): boolean {
    return pathname === '/forum/create' && searchParams?.get('draft') === draftId
  }

  async function handleSignOut() {
    await fetch('/api/forum/auth/logout', { method: 'POST' })
    router.push('/forum')
    router.refresh()
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/forum/drafts/${pendingDelete.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error("Couldn't delete that draft.")
        return
      }
      toast.success('Draft deleted.')
      // If the user is currently viewing the deleted draft, send them
      // back to a blank composer; otherwise just refresh the sidebar.
      if (isDraftActive(pendingDelete.id)) {
        router.push('/forum/create')
      }
      setPendingDelete(null)
      router.refresh()
    } catch {
      toast.error('Network error while deleting.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
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
            <React.Fragment key={group.label}>
              <SidebarGroup>
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
              {/* Drafts group sits BELOW the Posts group. Gated on
                drafts.length > 0 — an empty drafts list omits the
                group entirely (no empty header). */}
              {group.label === 'Posts' && drafts.length > 0 && (
                <SidebarGroup>
                  <SidebarGroupLabel>Drafts</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {drafts.map((draft) => {
                        const label = draft.title.trim() === '' ? 'Untitled draft' : draft.title
                        const active = isDraftActive(draft.id)
                        return (
                          <SidebarMenuItem key={draft.id}>
                            <SidebarMenuButton asChild isActive={active} tooltip={label}>
                              <Link href={`/forum/create?draft=${draft.id}`} prefetch>
                                <FileEdit />
                                <span className="truncate">{label}</span>
                              </Link>
                            </SidebarMenuButton>
                            <SidebarMenuAction
                              aria-label={`Delete draft ${label}`}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setPendingDelete(draft)
                              }}
                              showOnHover
                            >
                              <Trash2 />
                            </SidebarMenuAction>
                          </SidebarMenuItem>
                        )
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              )}
            </React.Fragment>
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
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete draft
              {pendingDelete
                ? ` "${pendingDelete.title.trim() === '' ? 'Untitled draft' : pendingDelete.title}"`
                : ''}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the draft and any attached images from your in-progress list.
              The content is gone — you can't recover it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

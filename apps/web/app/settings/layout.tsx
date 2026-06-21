/**
 * Settings shell layout — passkey gate + shadcn Sidebar shell (Phase 2).
 *
 * Decision tree, evaluated server-side on every request:
 *
 *   1. admins table EMPTY
 *      └── path !== `/settings/found` → redirect to `/settings/found`
 *      └── path === `/settings/found` → render the founding form
 *
 *   2. admins table NON-EMPTY, no session
 *      └── path !== `/settings/login` → redirect to `/settings/login`
 *      └── path === `/settings/login` → render the login form
 *
 *   3. admins table NON-EMPTY, session present
 *      └── path === `/settings/login` or `/settings/found` → redirect to
 *          `/settings` (already signed in)
 *      └── otherwise → render children inside the shadcn sidebar shell
 *
 * Auth surfaces (`/settings/login`, `/settings/found`) render without a
 * sidebar — they're full-bleed pages. Authenticated routes use
 * `<SidebarProvider> → <SettingsSidebar /> + <SidebarInset>`.
 */

import { isFoundingFlowAvailable, requireAdmin } from '@lucidindex/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { FoundingGate } from '@/components/auth/FoundingGate'
import { SettingsAuthGate } from '@/components/auth/SettingsAuthGate'
import { SiteFooter } from '@/components/chrome/SiteFooter'
import { TopNav } from '@/components/chrome/TopNav'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { SettingsSidebar } from './_components/SettingsSidebar'
import SettingsHubPage from './page'

// The settings shell decides routing per-request based on the admins table
// + iron-session cookie + the request URL header. Forcing dynamic here also
// flows through to every child page that doesn't already declare it.
export const dynamic = 'force-dynamic'

const FOUND_PATH = '/settings/found'
const LOGIN_PATH = '/settings/login'
const RECOVER_PATH = '/settings/recover'

/**
 * Read the current path from the `next-url` (or `x-invoke-path`) header
 * Next sets on RSC requests. We can't use `usePathname()` in a server
 * component, and `headers()` is the supported escape hatch for this.
 */
async function currentPath(): Promise<string> {
  const h = await headers()
  const nextUrl = h.get('next-url')
  if (nextUrl) return nextUrl
  const invokePath = h.get('x-invoke-path')
  if (invokePath) return invokePath
  const pathname = h.get('x-pathname')
  if (pathname) return pathname
  return '/settings'
}

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // The three checks are independent — `currentPath()` reads request headers,
  // `isFoundingFlowAvailable()` hits the admins table, `requireAdmin()` reads
  // the iron-session cookie. Running them in parallel cuts the layout's TTFB
  // from "sum of all three" to "max of all three". Cheap win, no semantic
  // change.
  const [path, foundingAvailable, session] = await Promise.all([
    currentPath(),
    isFoundingFlowAvailable(),
    requireAdmin(),
  ])

  if (foundingAvailable) {
    // Render the founding gate INLINE for every signed-out /settings/* path —
    // never redirect. A server redirect to /settings/found during a soft
    // (in-app) navigation makes Next's client router loop on
    // history.replaceState, so the page "loads nothing" until a hard refresh
    // (same failure mode the login gate hit). Keeping the URL put and rendering
    // the swipe-card dialog directly fixes the blank-on-first-click.
    return (
      <LockedSettingsShell>
        <FoundingGate />
      </LockedSettingsShell>
    )
  }

  if (!session) {
    // Render the auth gate INLINE — never redirect here. A server redirect to
    // /settings/login during a soft (in-app) navigation makes Next's client
    // router loop on history.replaceState, so the page "loads nothing" until a
    // hard refresh. Rendering the gate for every signed-out /settings/* path
    // keeps the URL put and shows the sign-in / passcode dialog immediately.
    return (
      <LockedSettingsShell>
        <SettingsAuthGate />
      </LockedSettingsShell>
    )
  }

  // Authenticated — but if they wandered onto an auth-surface URL, send
  // them to the hub instead of rendering the form behind a logged-in shell.
  if (path === LOGIN_PATH || path === FOUND_PATH || path === RECOVER_PATH) {
    redirect('/settings')
  }

  // Authenticated: the normal, fully-usable settings shell. No blur here —
  // the frosted/locked treatment belongs to the signed-out gate, the same way
  // the forum is only blurred behind its login dialog and plain once you're in.
  return (
    <SidebarProvider>
      <div className="flex w-full flex-col">
        <TopNav />
        <div className="flex flex-1">
          <SettingsSidebar />
          <SidebarInset>
            <div className="flex flex-1 flex-col gap-4 p-6">{children}</div>
            <SiteFooter />
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  )
}

/**
 * LockedSettingsShell — the signed-out admin surface.
 *
 * Renders the static Overview hub as a *locked* backdrop: the content is
 * `inert` (no clicks, no tab focus, no selection, removed from the a11y tree)
 * and frosted by a backdrop-blur scrim, with the sign-in / founding dialog
 * floated foremost on top.
 *
 * Mirrors the forum gate: signed-out = the app, locked behind a dialog;
 * signed-in = the same app, live.
 *
 * No sidebar here on purpose. It's "closed until you sign in", AND a collapsed
 * icon rail can't be frosted flat: the blur spreads its light icon glyphs
 * across the narrow rail, so it reads as a lighter vertical band against the
 * otherwise-uniform dark surface (every other surface is one flat #242322).
 * Dropping it keeps the whole backdrop a single black.
 *
 * The blur is a `backdrop-blur` overlay, NOT a `filter: blur` wrapper — `filter`
 * establishes a containing block that complicates fixed/positioned descendants;
 * the overlay just frosts everything painted behind it.
 */
function LockedSettingsShell({ children }: { children: ReactNode }) {
  return (
    // Pinned to the viewport with overflow clipped — the locked content behind
    // the dialog must not scroll (the Overview hub is taller than the viewport).
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Header stays crisp + interactive, like the forum gate. */}
      <TopNav hideSearch hideSidebarTrigger />
      <div className="relative flex flex-1 overflow-hidden">
        {/* The settings content underneath — rendered for real, but inert. */}
        <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6" inert aria-hidden="true">
          <SettingsHubPage />
        </div>
        {/* Frosted glass: dims + blurs the locked content behind it. */}
        <div
          className="pointer-events-none absolute inset-0 z-40 bg-background/40 backdrop-blur-md"
          aria-hidden="true"
        />
        {/* Sign-in / founding dialog — foremost and interactive. */}
        <div className="absolute inset-0 z-50 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[480px]">{children}</div>
        </div>
      </div>
    </div>
  )
}

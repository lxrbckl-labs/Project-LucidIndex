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
import { TopNav } from '@/components/chrome/TopNav'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { SettingsSidebar } from './_components/SettingsSidebar'

// The settings shell decides routing per-request based on the admins table
// + iron-session cookie + the request URL header. Forcing dynamic here also
// flows through to every child page that doesn't already declare it.
export const dynamic = 'force-dynamic'

const FOUND_PATH = '/settings/found'
const LOGIN_PATH = '/settings/login'

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
  const path = await currentPath()
  const foundingAvailable = await isFoundingFlowAvailable()
  const session = await requireAdmin()

  if (foundingAvailable) {
    if (path !== FOUND_PATH) {
      redirect(FOUND_PATH)
    }
    return <AuthSurface>{children}</AuthSurface>
  }

  if (!session) {
    if (path !== LOGIN_PATH) {
      redirect(LOGIN_PATH)
    }
    return <AuthSurface>{children}</AuthSurface>
  }

  // Authenticated — but if they wandered onto an auth-surface URL, send
  // them to the hub instead of rendering the form behind a logged-in shell.
  if (path === LOGIN_PATH || path === FOUND_PATH) {
    redirect('/settings')
  }

  return (
    <SidebarProvider>
      <div className="flex w-full flex-col">
        <TopNav />
        <div className="flex flex-1">
          <SettingsSidebar />
          <SidebarInset>
            <div className="flex flex-1 flex-col gap-4 p-6">{children}</div>
          </SidebarInset>
        </div>
      </div>
      <Toaster />
    </SidebarProvider>
  )
}

function AuthSurface({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-start px-6 pt-24 pb-24">
      <div className="w-full max-w-[480px]">{children}</div>
    </main>
  )
}

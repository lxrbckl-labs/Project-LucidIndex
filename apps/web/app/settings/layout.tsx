/**
 * Settings shell layout — the passkey gate for every `/settings/*` route.
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
 *          `/settings` (already signed in, no need to see auth surfaces)
 *      └── otherwise → render the children inside the sidebar shell
 *
 * The auth-surface routes (`/settings/login`, `/settings/found`) render
 * children WITHOUT the sidebar — they're full-bleed pages, since the
 * sidebar is itself authenticated UI. The hub + sub-panels render WITH
 * the sidebar.
 */

import { isFoundingFlowAvailable, requireAdmin } from '@lucidindex/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { SettingsSidebar } from './_components/SettingsSidebar'

const FOUND_PATH = '/settings/found'
const LOGIN_PATH = '/settings/login'

/**
 * Read the current path from the `next-url` (or `x-invoke-path`) header
 * Next sets on RSC requests. We can't use `usePathname()` in a server
 * component, and `headers()` is the supported escape hatch for this.
 *
 * Falls back to `/settings` if the header is missing — defensive only;
 * the Next runtime always sets one of these for a layout render.
 */
async function currentPath(): Promise<string> {
  const h = await headers()
  const nextUrl = h.get('next-url')
  if (nextUrl) return nextUrl
  const invokePath = h.get('x-invoke-path')
  if (invokePath) return invokePath
  // Last-ditch — middleware writes the original path here in some setups.
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
    <div className="min-h-screen bg-white text-black flex">
      <SettingsSidebar />
      <main className="flex-1 px-8 py-12 md:px-12">{children}</main>
    </div>
  )
}

function AuthSurface({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-white text-black flex flex-col items-center justify-start px-6 pt-24 pb-24">
      <div className="w-full max-w-[480px]">{children}</div>
    </main>
  )
}

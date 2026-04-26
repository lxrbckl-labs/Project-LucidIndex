/**
 * Middleware — inject `x-pathname` so server components (RSC, layouts)
 * can read the current request path via `next/headers`.
 *
 * Next.js layouts have no equivalent of `usePathname()` — `headers()`
 * exposes only the inbound HTTP headers. Some requests carry a
 * `next-url` (RSC navigation) but full-page loads don't, so we need a
 * stable header set on every request. Middleware runs before any
 * route handler / page render and can mutate the request headers Next
 * forwards into the framework, so this is the cleanest place for it.
 *
 * The Settings layout uses this header to decide whether to redirect
 * to `/settings/found`, `/settings/login`, or render the authenticated
 * shell — and it needs to know the path to break the redirect-when-
 * already-on-target loop.
 */

import { type NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers)
  headers.set('x-pathname', req.nextUrl.pathname)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  // Run on every Settings + auth route. Excludes `_next/*` static assets,
  // images, and the `favicon.ico` to keep the dev overhead near-zero.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

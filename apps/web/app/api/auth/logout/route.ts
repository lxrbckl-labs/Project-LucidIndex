/**
 * POST /api/auth/logout
 *
 * Clear the iron-session cookie. Always returns `{ ok: true }` — no
 * reason to surface "you weren't signed in anyway" to a logout caller.
 */

import { destroySession } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

// Touches the iron-session cookie via destroySession() — must execute
// per-request, never at build time when no cookie store exists.
export const dynamic = 'force-dynamic'

export async function POST() {
  await destroySession()
  return NextResponse.json({ ok: true })
}

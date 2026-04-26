/**
 * POST /api/auth/logout
 *
 * Clear the iron-session cookie. Always returns `{ ok: true }` — no
 * reason to surface "you weren't signed in anyway" to a logout caller.
 */

import { destroySession } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

export async function POST() {
  await destroySession()
  return NextResponse.json({ ok: true })
}

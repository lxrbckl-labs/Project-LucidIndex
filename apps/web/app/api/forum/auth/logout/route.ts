/**
 * POST /api/forum/auth/logout
 *
 * Destroys the forum-user iron-session cookie. Idempotent — calling it
 * without a session is a no-op success. Returns `{ ok: true }` on the
 * happy path so callers can update UI without a follow-up read.
 */

import { destroyForumSession } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  await destroyForumSession()
  return NextResponse.json({ ok: true })
}

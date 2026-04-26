/**
 * GET /api/auth/session
 *
 * Returns the current session info, or 401 if there is no active session.
 * Used by client-side guards that need to check auth state without
 * triggering a full RSC render.
 */

import { getSession } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

// Reads the iron-session cookie — request-scoped, must never be statically
// rendered at build time.
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session.adminId) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({
    ok: true,
    adminId: session.adminId,
    credentialId: session.credentialId ?? null,
  })
}

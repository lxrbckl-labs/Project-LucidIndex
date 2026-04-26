/**
 * POST /api/auth/founding/finalize
 *
 * Mint the iron-session cookie after the recovery-code modal is dismissed.
 * Split out from `/finish` because setting the session cookie inside the
 * `/finish` response triggers an RSC refresh that would unmount the
 * `FoundingAdminForm` before the user could read the recovery code.
 *
 * Body shape: `{ adminId: string, credentialId: string }`.
 */

import { finalizeFoundingSession } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

// Mints the iron-session cookie — request-scoped.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const { adminId, credentialId } = body as {
    adminId?: unknown
    credentialId?: unknown
  }
  if (typeof adminId !== 'string' || typeof credentialId !== 'string') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  try {
    const result = await finalizeFoundingSession({ adminId, credentialId })
    if (!result.ok) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}

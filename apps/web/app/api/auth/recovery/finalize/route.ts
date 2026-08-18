/**
 * POST /api/auth/recovery/finalize
 *
 * Final step of passkey recovery: mint the iron-session cookie after the
 * new-recovery-code modal is dismissed. Split out from `/finish` for the same
 * reason as the founding flow — setting the session cookie mid-RSC triggers a
 * refresh that would unmount the form before the user can read the new code.
 *
 * `finalizeRecoverySession` guards against replay: it only mints a session for
 * a credential that was enrolled in the last few minutes and belongs to the
 * named admin.
 *
 * Body shape: `{ adminId: string, credentialId: string }`.
 */

import { finalizeRecoverySession } from '@lucidindex/auth'
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
    const result = await finalizeRecoverySession({ adminId, credentialId })
    if (!result.ok) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}

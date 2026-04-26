/**
 * POST /api/auth/passkey/register/start
 *
 * Begin registration of an additional passkey for the currently signed-in
 * admin. Generates WebAuthn registration options, stashes the challenge,
 * and returns a challengeToken the client carries to `register/finish`.
 *
 * The founding flow (claiming the FIRST admin passkey) lives at
 * `/api/auth/founding/*`, NOT here. This route is strictly for adding a
 * second (or further) passkey to an existing admin's account.
 *
 * Body shape: `{ deviceLabel: string }`
 */

import { requireAdmin, startPasskeyRegistration } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { stashChallenge } from '../../../../../../lib/challenge-store'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const { deviceLabel } = body as { deviceLabel?: unknown }
  if (typeof deviceLabel !== 'string' || deviceLabel.trim().length === 0) {
    return NextResponse.json({ ok: false, reason: 'device_label_required' }, { status: 400 })
  }

  try {
    const result = await startPasskeyRegistration(session.adminId as string, deviceLabel)
    if (!result.ok) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    const challengeToken = stashChallenge(result.options.challenge)
    return NextResponse.json({ ok: true, options: result.options, challengeToken })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

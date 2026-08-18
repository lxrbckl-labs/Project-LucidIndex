/**
 * POST /api/auth/passcode/signin
 *
 * Reusable passcode sign-in: verify the admin's passcode and, on match, mint
 * the session. No WebAuthn, no enrollment, no consumption — the passcode is a
 * standing alternate credential.
 *
 * Brute-force guard: every attempt is counted against a per-client throttle
 * before the code is checked. (The 256-bit passcode makes guessing infeasible
 * anyway; the throttle is belt-and-suspenders.)
 *
 * Body shape: `{ passcode: string }`
 */

import { signInWithPasscode } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { clientKeyFromRequest, recordRecoveryAttempt } from '../../../../../lib/recovery-throttle'

// Mints the iron-session cookie + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const throttle = recordRecoveryAttempt(clientKeyFromRequest(req))
  if (!throttle.allowed) {
    return NextResponse.json(
      { ok: false, reason: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(throttle.retryAfterSec) } },
    )
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
  const { passcode } = body as { passcode?: unknown }
  if (typeof passcode !== 'string' || passcode.trim().length === 0) {
    return NextResponse.json({ ok: false, reason: 'invalid_passcode' }, { status: 200 })
  }

  try {
    const result = await signInWithPasscode(passcode)
    if (!result.ok) {
      return NextResponse.json({ ok: false, reason: 'invalid_passcode' }, { status: 200 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

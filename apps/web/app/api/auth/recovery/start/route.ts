/**
 * POST /api/auth/recovery/start
 *
 * First step of passkey recovery: the admin proves possession of their
 * one-time recovery code. If it matches, we return WebAuthn registration
 * options for enrolling a NEW passkey, plus a challenge token the client
 * carries to `recovery/finish`.
 *
 * Brute-force guard: every call is counted against a per-client throttle
 * BEFORE the code is checked, so an attacker can't dodge it. Invalid codes and
 * option-generation failures collapse to the same `invalid_code` response so
 * the endpoint isn't an oracle for "was this code close?".
 *
 * Body shape: `{ recoveryCode: string }`
 */

import { startRecoveryEnrollment } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { stashChallenge } from '../../../../../lib/challenge-store'
import { clientKeyFromRequest, recordRecoveryAttempt } from '../../../../../lib/recovery-throttle'

// DB-backed (recovery-code lookup) — must execute per-request.
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
  const { recoveryCode } = body as { recoveryCode?: unknown }
  if (typeof recoveryCode !== 'string' || recoveryCode.trim().length === 0) {
    return NextResponse.json({ ok: false, reason: 'invalid_code' }, { status: 200 })
  }

  try {
    const result = await startRecoveryEnrollment(recoveryCode)
    if (!result.ok) {
      // Uniform response for both 'invalid_code' and 'generate_failed' — no oracle.
      return NextResponse.json({ ok: false, reason: 'invalid_code' }, { status: 200 })
    }
    const challengeToken = stashChallenge(result.options.challenge)
    return NextResponse.json({ ok: true, options: result.options, challengeToken })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

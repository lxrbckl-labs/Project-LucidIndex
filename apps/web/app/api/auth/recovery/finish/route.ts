/**
 * POST /api/auth/recovery/finish
 *
 * Second step of passkey recovery: verify the new passkey's attestation, then
 * atomically burn the recovery code, enroll the credential, and issue a fresh
 * recovery code. Returns the new plaintext code for one-time display.
 *
 * Does NOT mint a session — that's `recovery/finalize`, called after the
 * new-recovery-code modal is dismissed (same RSC-unmount reason as the
 * founding flow).
 *
 * The recovery code is re-checked here (not trusted from `start`) so that its
 * consumption is atomic with a fresh verification.
 *
 * Body shape:
 *   { challengeToken: string, recoveryCode: string,
 *     deviceLabel?: string, attestation: RegistrationResponseJSON }
 */

import { finishRecoveryEnrollment } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { redeemChallenge } from '../../../../../lib/challenge-store'
import { clearRecoveryAttempts, clientKeyFromRequest } from '../../../../../lib/recovery-throttle'

// DB-backed transaction — must execute per-request.
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
  const { challengeToken, recoveryCode, deviceLabel, attestation } = body as {
    challengeToken?: unknown
    recoveryCode?: unknown
    deviceLabel?: unknown
    attestation?: unknown
  }
  if (
    typeof challengeToken !== 'string' ||
    typeof recoveryCode !== 'string' ||
    recoveryCode.trim().length === 0 ||
    !attestation ||
    typeof attestation !== 'object' ||
    (deviceLabel !== undefined && typeof deviceLabel !== 'string')
  ) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const expectedChallenge = redeemChallenge(challengeToken)
  if (!expectedChallenge) {
    return NextResponse.json({ ok: false, reason: 'challenge_expired' }, { status: 200 })
  }

  try {
    const result = await finishRecoveryEnrollment({
      code: recoveryCode,
      ...(deviceLabel ? { deviceLabel } : {}),
      response: attestation as Parameters<typeof finishRecoveryEnrollment>[0]['response'],
      expectedChallenge,
    })
    if (!result.ok) {
      return NextResponse.json({ ok: false, reason: result.reason }, { status: 200 })
    }
    // Successful recovery — drop the client's throttle bucket.
    clearRecoveryAttempts(clientKeyFromRequest(req))
    return NextResponse.json({
      ok: true,
      adminId: result.adminId,
      credentialId: result.credentialId,
      recoveryCode: result.recoveryCode,
    })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

/**
 * POST /api/auth/passkey/register/finish
 *
 * Finalize registration of an additional passkey for the currently signed-in
 * admin. Verifies the attestation, inserts a new `credentials` row scoped
 * to the existing admin's id, and logs the event to `auth_events`.
 *
 * Body shape:
 *   { challengeToken: string, deviceLabel: string, attestation: RegistrationResponseJSON }
 */

import { finishPasskeyRegistration, requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { redeemChallenge } from '../../../../../../lib/challenge-store'

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
  const { challengeToken, deviceLabel, attestation } = body as {
    challengeToken?: unknown
    deviceLabel?: unknown
    attestation?: unknown
  }
  if (
    typeof challengeToken !== 'string' ||
    typeof deviceLabel !== 'string' ||
    deviceLabel.trim().length === 0 ||
    !attestation ||
    typeof attestation !== 'object'
  ) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const expectedChallenge = redeemChallenge(challengeToken)
  if (!expectedChallenge) {
    return NextResponse.json({ ok: false, reason: 'challenge_expired' }, { status: 200 })
  }

  try {
    const result = await finishPasskeyRegistration({
      adminId: session.adminId as string,
      deviceLabel,
      response: attestation as Parameters<typeof finishPasskeyRegistration>[0]['response'],
      expectedChallenge,
    })
    if (!result.ok) {
      return NextResponse.json({ ok: false, reason: result.reason }, { status: 200 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

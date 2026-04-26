/**
 * POST /api/auth/founding/start
 *
 * Begin the founding-admin WebAuthn registration ceremony. Only succeeds
 * when the `admins` table is empty. Returns the WebAuthn options for
 * `@simplewebauthn/browser#startRegistration` plus a `challengeToken`
 * the client carries back to `/api/auth/founding/finish`.
 *
 * Body shape: `{ deviceLabel: string }`.
 */

import { startFoundingEnrollment } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { stashChallenge } from '../../../../../lib/challenge-store'

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
  const { deviceLabel } = body as { deviceLabel?: unknown }
  if (typeof deviceLabel !== 'string') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  try {
    const result = await startFoundingEnrollment(deviceLabel)
    if (!result.ok) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    const challengeToken = stashChallenge(result.options.challenge)
    return NextResponse.json({ ok: true, options: result.options, challengeToken })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}

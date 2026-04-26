/**
 * POST /api/auth/passkey/authenticate/finish
 *
 * Verifies the WebAuthn assertion produced by
 * `@simplewebauthn/browser#startAuthentication`. On success, mints the
 * iron-session cookie via `finishLogin()` and returns `{ ok: true }`.
 *
 * Body shape:
 *   { challengeToken: string, assertion: AuthenticationResponseJSON }
 */

import { finishLogin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { redeemChallenge } from '../../../../../../lib/challenge-store'

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
  const { challengeToken, assertion } = body as {
    challengeToken?: unknown
    assertion?: unknown
  }
  if (typeof challengeToken !== 'string' || !assertion || typeof assertion !== 'object') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const expectedChallenge = redeemChallenge(challengeToken)
  if (!expectedChallenge) {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  try {
    // SimpleWebAuthn types `AuthenticationResponseJSON` strictly; we narrow
    // structurally and let the verifier reject malformed values.
    const result = await finishLogin({
      response: assertion as Parameters<typeof finishLogin>[0]['response'],
      expectedChallenge,
    })
    if (!result.ok) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}

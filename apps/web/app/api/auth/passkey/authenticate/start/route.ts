/**
 * POST /api/auth/passkey/authenticate/start
 *
 * Kicks off the passkey-login WebAuthn ceremony. Returns the options for
 * `@simplewebauthn/browser#startAuthentication` plus a `challengeToken`
 * the client carries back to `/api/auth/passkey/authenticate/finish`.
 *
 * On any failure (no admin, no credentials registered, server error) we
 * return `{ ok: false }` rather than enumerating reasons — same
 * "no information leak" stance as Showalter.
 */

import { startLogin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { stashChallenge } from '../../../../../../lib/challenge-store'

export async function POST() {
  try {
    const result = await startLogin()
    if (!result.ok) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    const challengeToken = stashChallenge(result.options.challenge)
    return NextResponse.json({ ok: true, options: result.options, challengeToken })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}

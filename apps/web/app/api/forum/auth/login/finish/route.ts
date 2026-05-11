/**
 * POST /api/forum/auth/login/finish
 *
 * Verifies the WebAuthn assertion produced by
 * `@simplewebauthn/browser#startAuthentication`. On success, mints the
 * forum iron-session cookie via `finishForumLogin()` and returns
 * `{ ok: true, username }` so the client can render the signed-in
 * state without an extra round-trip.
 *
 * Failure modes return `{ ok: false, reason }` with a stable, narrow
 * vocabulary so the client can show specific messaging without
 * ambiguity:
 *   - 'invalid_request'    — body shape was wrong
 *   - 'expired_challenge'  — token redeem failed (reuse, expiry, miss)
 *   - 'unknown'            — credential isn't registered
 *   - 'access_revoked'     — admin revoked the user's invite
 *   - 'verify_failed'      — assertion didn't verify against the stored key
 *
 * Body shape:
 *   { challengeToken: string, assertion: AuthenticationResponseJSON }
 */

import { finishForumLogin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { redeemChallenge } from '../../../../../../lib/challenge-store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }
  const { challengeToken, assertion } = body as {
    challengeToken?: unknown
    assertion?: unknown
  }
  if (typeof challengeToken !== 'string' || !assertion || typeof assertion !== 'object') {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }

  const expectedChallenge = redeemChallenge(challengeToken)
  if (!expectedChallenge) {
    return NextResponse.json({ ok: false, reason: 'expired_challenge' }, { status: 200 })
  }

  try {
    const result = await finishForumLogin({
      response: assertion as Parameters<typeof finishForumLogin>[0]['response'],
      expectedChallenge,
    })
    if (!result.ok) {
      // Map both 'credential_not_found' and 'no_invite_anchor' to
      // 'unknown' on the wire — neither leaks meaningful info to the
      // client beyond "this passkey doesn't sign you in here".
      const reason =
        result.reason === 'credential_not_found' || result.reason === 'no_invite_anchor'
          ? 'unknown'
          : result.reason
      return NextResponse.json({ ok: false, reason }, { status: 200 })
    }
    return NextResponse.json({ ok: true, username: result.username })
  } catch {
    return NextResponse.json({ ok: false, reason: 'verify_failed' }, { status: 200 })
  }
}

/**
 * POST /api/forum/auth/signup/finish
 *
 * Phase D signup ceremony, step 2. Verifies the registration
 * attestation produced by `@simplewebauthn/browser#startRegistration`,
 * then atomically creates the forum_user, redeems the invite, and
 * persists the credential. On success the forum session cookie is
 * minted server-side so the next request renders the signed-in view
 * without an extra round-trip.
 *
 * Body: { challengeToken, attestation, code, username }
 * Response shapes:
 *   { ok: true, username }
 *   { ok: false, reason }
 *
 * Failure vocabulary mirrors the repo result type, plus the transport
 * concerns this layer owns:
 *   'invalid_request'   — body shape was wrong
 *   'expired_challenge' — token couldn't be redeemed (reuse / expiry)
 *   plus everything `finishForumRegistration` can return.
 */

import { finishForumRegistration } from '@lucidindex/auth'
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
  const { challengeToken, attestation, code, username } = body as {
    challengeToken?: unknown
    attestation?: unknown
    code?: unknown
    username?: unknown
  }
  if (
    typeof challengeToken !== 'string' ||
    !attestation ||
    typeof attestation !== 'object' ||
    typeof code !== 'string' ||
    typeof username !== 'string'
  ) {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }

  const expectedChallenge = redeemChallenge(challengeToken)
  if (!expectedChallenge) {
    return NextResponse.json({ ok: false, reason: 'expired_challenge' }, { status: 200 })
  }

  try {
    const result = await finishForumRegistration({
      code,
      username,
      response: attestation as Parameters<typeof finishForumRegistration>[0]['response'],
      expectedChallenge,
    })
    if (!result.ok) {
      return NextResponse.json({ ok: false, reason: result.reason }, { status: 200 })
    }
    return NextResponse.json({ ok: true, username: result.username })
  } catch {
    return NextResponse.json({ ok: false, reason: 'verify_failed' }, { status: 200 })
  }
}

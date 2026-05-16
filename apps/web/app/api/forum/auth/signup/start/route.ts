/**
 * POST /api/forum/auth/signup/start
 *
 * Phase D signup ceremony, step 1. Validates the requested username
 * shape + availability, confirms the invite code resolves to a still-
 * redeemable invite, and returns the WebAuthn registration options for
 * `@simplewebauthn/browser#startRegistration`.
 *
 * Body: { code: string, username: string }
 * Response shapes:
 *   { ok: true, options, challengeToken }
 *   { ok: false, reason: 'invalid_request' | 'invalid_username'
 *                       | 'username_taken' | 'invalid_invite'
 *                       | 'generate_failed' }
 *
 * Public — anyone holding a valid invite code can hit this. The invite
 * lookup is the gate; without it the registration ceremony refuses to
 * proceed.
 */

import { startForumRegistration } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { stashChallenge } from '../../../../../../lib/challenge-store'

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
  const { code, username } = body as { code?: unknown; username?: unknown }
  if (typeof code !== 'string' || typeof username !== 'string') {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }

  const result = await startForumRegistration({ code, username })
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 200 })
  }
  const challengeToken = stashChallenge(result.options.challenge)
  return NextResponse.json({ ok: true, options: result.options, challengeToken })
}

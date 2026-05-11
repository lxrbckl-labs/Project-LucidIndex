/**
 * POST /api/forum/auth/login/start
 *
 * Kicks off the forum-user passkey-login WebAuthn ceremony. Returns the
 * options for `@simplewebauthn/browser#startAuthentication` plus a
 * `challengeToken` the client carries back to `/finish`.
 *
 * Public — anyone reaching `/forum` can request login options. The
 * actual authentication happens at `/finish`, which enforces the invite
 * kill-switch and credential lookup.
 */

import { startForumLogin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'
import { stashChallenge } from '../../../../../../lib/challenge-store'

// DB-backed (eventually — start currently doesn't read the DB but
// finish does and shares the same module): force per-request execution.
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const result = await startForumLogin()
    if (!result.ok) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    const challengeToken = stashChallenge(result.options.challenge)
    return NextResponse.json({ ok: true, options: result.options, challengeToken })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}

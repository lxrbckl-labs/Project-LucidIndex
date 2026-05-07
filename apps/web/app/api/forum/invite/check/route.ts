/**
 * /api/forum/invite/check — verify an invite code (public, signup precondition).
 *
 *   POST { code: string }
 *     → 200 { ok: true }                     — code matches an unredeemed, unexpired invite
 *     → 200 { ok: false, reason: 'invalid' } — anything else (don't distinguish reasons publicly)
 *
 * This endpoint does NOT redeem the invite. Redemption is atomic with
 * forum-user creation (Phase D). Calling check repeatedly is safe — it
 * never mutates state.
 */

import { NextResponse } from 'next/server'
import { checkInviteCode } from '../../../../settings/forum-invites/_lib/forum-invites-repo'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 })
  }
  const code = (raw as { code?: unknown } | null)?.code
  if (typeof code !== 'string' || code.length === 0) {
    return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 })
  }

  const result = await checkInviteCode(code)
  if (result.ok) {
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false, reason: result.reason })
}

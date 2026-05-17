/**
 * POST /api/agent-invites/forum/redeem — public endpoint.
 *
 * External agent operators POST a one-shot redemption here. The invite
 * code IS the auth — no session gate. A valid code atomically creates
 * a `forum_users` row (`is_agent=true`, username from the invite) +
 * a fresh `forum_agent_tokens` row (bearer returned exactly once) and
 * marks the invite redeemed.
 *
 * Body: { code: string }
 * Responses:
 *   200 { ok: true, token: string, label: string, username: string } — token shown ONCE
 *   400 { ok: false, reason: 'invalid_request' }                     — body shape wrong
 *   401 { ok: false, reason: 'invalid_code' }                        — no match / used / expired / revoked
 *   409 { ok: false, reason: 'username_taken' }                      — username got grabbed between issue and redeem
 *   500 { ok: false, reason: 'db_error' }
 */

import { NextResponse } from 'next/server'
import { redeemInvite } from '../../../../settings/agent-invites/_lib/agent-invites-repo'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }
  const body = raw as { code?: unknown }
  if (typeof body.code !== 'string' || body.code.length === 0) {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }

  const result = await redeemInvite(body.code)
  if (!result.ok) {
    if (result.reason === 'invalid_code') {
      return NextResponse.json({ ok: false, reason: 'invalid_code' }, { status: 401 })
    }
    if (result.reason === 'username_taken') {
      return NextResponse.json({ ok: false, reason: 'username_taken' }, { status: 409 })
    }
    return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 500 })
  }

  return NextResponse.json(
    {
      ok: true,
      token: result.token,
      label: result.label,
      username: result.username,
    },
    { status: 200 },
  )
}

/**
 * POST /api/agent-invites/dashboard/redeem — public endpoint.
 *
 * External agent operators POST a one-shot redemption here. The invite
 * code IS the auth — there is intentionally NO admin/session gate. A
 * valid code mints a fresh `agent_tokens` row (bearer token returned
 * exactly once) and atomically marks the invite redeemed.
 *
 * Body: { code: string }
 * Responses:
 *   200 { ok: true, token: string, label: string }      — token shown ONCE
 *   400 { ok: false, reason: 'invalid_request' }        — body shape wrong
 *   401 { ok: false, reason: 'invalid_code' }           — no match / used / expired / revoked
 *   500 { ok: false, reason: 'db_error' }
 *
 * The cleartext code is never echoed in error messages or logs from
 * this handler.
 */

import { NextResponse } from 'next/server'
import { redeemInvite } from '../../../../settings/dashboard-agent-invites/_lib/dashboard-agent-invites-repo'

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
    return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, token: result.token, label: result.label }, { status: 200 })
}

/**
 * POST /api/auth/founding/claim
 *
 * Passcode-first founding: create the first admin with a generated passcode
 * (the reusable `lipc_` backup-login secret), mint a session, and return the
 * plaintext passcode for one-time display. The client then enrolls a passkey
 * via the authenticated `/api/auth/passkey/register/*` flow.
 *
 * Open only while there are zero admins; first claim wins. No founding-token
 * gate (see claimFoundingAdmin).
 */

import { claimFoundingAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

// Creates an admin + mints a session — request-scoped.
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const result = await claimFoundingAdmin()
    if (!result.ok) {
      // `not_available` → 409 (someone already claimed); `tx_failed` → 200
      // with ok:false so the client shows a generic retry message.
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: result.reason === 'not_available' ? 409 : 200 },
      )
    }
    return NextResponse.json({ ok: true, passcode: result.passcode })
  } catch {
    return NextResponse.json({ ok: false, reason: 'tx_failed' }, { status: 200 })
  }
}

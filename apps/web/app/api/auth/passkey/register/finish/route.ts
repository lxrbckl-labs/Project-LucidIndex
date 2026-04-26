/**
 * POST /api/auth/passkey/register/finish
 *
 * Finalize registration of an additional passkey for the currently signed-in
 * admin. Phase 1 stub — full implementation lands with the Account panel
 * (#36). The matching `start` route is also a stub; both return 501 so
 * the contract is visible without shipping a partial flow.
 */

import { getSession } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

export async function POST() {
  const session = await getSession()
  if (!session.adminId) {
    return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })
  }
  // TODO(#36): redeem challenge, verify attestation, persist credential.
  return NextResponse.json({ ok: false, reason: 'not_implemented' }, { status: 501 })
}

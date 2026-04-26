/**
 * POST /api/auth/passkey/register/start
 *
 * Begin registration of an additional passkey for the currently signed-in
 * admin. Phase 1 only scaffolds the route — the Account panel (#36)
 * implements the full add-another-passkey UX. For now this returns
 * `{ ok: false, reason: 'not_implemented' }` so the contract is visible
 * without leaking a half-built implementation.
 *
 * The founding flow (claiming the FIRST admin passkey) lives at
 * `/api/auth/founding/*`, NOT here.
 */

import { getSession } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

export async function POST() {
  const session = await getSession()
  if (!session.adminId) {
    return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })
  }
  // TODO(#36): generate registration options, stash challenge, return token.
  return NextResponse.json({ ok: false, reason: 'not_implemented' }, { status: 501 })
}

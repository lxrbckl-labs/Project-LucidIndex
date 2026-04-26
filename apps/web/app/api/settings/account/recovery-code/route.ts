/**
 * POST /api/settings/account/recovery-code
 *
 * Regenerate the admin's recovery code:
 *   1. Mark all unconsumed `recovery_codes` for this admin as consumed now.
 *   2. Generate a new plaintext code, hash it (argon2id), insert a new row.
 *   3. Log `auth_events` with kind=`recovery_regenerated`.
 *   4. Return the cleartext code ONCE — the client must display it immediately.
 *      Subsequent calls generate a new code; the previous one is irrevocably burned.
 *
 * Authenticated admin only. No request body required.
 */

import { regenerateRecoveryCode, requireAdmin } from '@lucidindex/auth'
import { NextResponse } from 'next/server'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })
  }

  const result = await regenerateRecoveryCode(session.adminId as string)
  if (!result.ok) {
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  // Return the plaintext code exactly once. The server stores only the hash.
  return NextResponse.json({ ok: true, recoveryCode: result.recoveryCode })
}

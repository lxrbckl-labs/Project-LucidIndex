/**
 * Passcode sign-in — the reusable alternate-login path.
 *
 * The admin enters their passcode (the `lipc_…` secret issued at founding /
 * regeneration) to sign in when they don't have their passkey. Unlike the
 * passkey ceremony there is no WebAuthn — just verify the secret and mint the
 * session. The passcode is REUSABLE: it is not consumed on use, only rotated
 * via Settings → Account.
 *
 * Verification reuses the seam-tested `findAdminForCode` (argon2 scan over the
 * active, unconsumed passcode rows). A successful sign-in logs `recovery_used`.
 */

import { db } from '@lucidindex/db/client'
import { authEvents } from '@lucidindex/db/schema'
import { verifyHash } from './recovery.js'
import { makeDrizzleRecoveryStore } from './recovery-login.js'
import { findAdminForCode } from './recovery-login-core.js'
import { establishSession } from './session.js'

/**
 * Session `credentialId` marker for passcode-minted sessions. WebAuthn
 * credential ids are base64url and never equal this, so it's an unambiguous
 * "this session came from a passcode, not a device" signal for future
 * device-management features.
 */
export const PASSCODE_SESSION_MARKER = 'passcode'

export type PasscodeSignInResult = { ok: true } | { ok: false }

/**
 * Verify a passcode and, on match, mint an admin session. Reusable: the
 * passcode is left active. Returns `{ ok: false }` for any non-match (no
 * oracle distinguishing "wrong" from "malformed").
 */
export async function signInWithPasscode(code: string): Promise<PasscodeSignInResult> {
  const match = await findAdminForCode(makeDrizzleRecoveryStore(), verifyHash, code)
  if (!match.ok) {
    return { ok: false }
  }

  await establishSession({ adminId: match.adminId, credentialId: PASSCODE_SESSION_MARKER })
  await db.insert(authEvents).values({
    adminId: match.adminId,
    kind: 'recovery_used',
    details: { via: 'passcode' },
  })
  return { ok: true }
}

/**
 * Recovery-code management actions.
 *
 * Server-side action for the Settings → Account panel: regenerate the
 * admin's recovery code with burn-old semantics. Exposed as a named export
 * from `@lucidindex/auth` so the route handler in `apps/web` doesn't need
 * to import from `@lucidindex/db` or `drizzle-orm` directly.
 */

import { db } from '@lucidindex/db/client'
import { authEvents, recoveryCodes } from '@lucidindex/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { generatePlaintextCode, hashCode } from './recovery.js'

export type RegenerateRecoveryCodeResult =
  | { ok: true; recoveryCode: string }
  | { ok: false; reason: string }

/**
 * Regenerate the recovery code for an admin:
 *   1. Mark all unconsumed `recovery_codes` rows for this admin as consumed.
 *   2. Generate a new plaintext code, hash it (argon2id), insert a new row.
 *   3. Log `auth_events` with kind=`recovery_regenerated`.
 *   4. Return the plaintext code exactly once — the client must display it
 *      immediately; there is no second chance.
 *
 * Wrapped in a transaction so a crash between the burn and the insert can't
 * leave the admin with zero valid codes.
 *
 * The `adminId` comes from the session — the caller is responsible for
 * verifying the session before calling this.
 */
export async function regenerateRecoveryCode(
  adminId: string,
): Promise<RegenerateRecoveryCodeResult> {
  if (!adminId) {
    return { ok: false, reason: 'invalid_input' }
  }

  try {
    const plaintextCode = generatePlaintextCode()
    const codeHash = await hashCode(plaintextCode)

    await db.transaction(async (tx) => {
      // Burn every unconsumed code for this admin.
      await tx
        .update(recoveryCodes)
        .set({ consumedAt: new Date() })
        .where(and(eq(recoveryCodes.adminId, adminId), isNull(recoveryCodes.consumedAt)))

      // Insert the fresh code.
      await tx.insert(recoveryCodes).values({ adminId, codeHash })

      // Audit log.
      await tx.insert(authEvents).values({
        adminId,
        kind: 'recovery_regenerated',
        details: {},
      })
    })

    // Return the plaintext code once — the server stores only the hash.
    return { ok: true, recoveryCode: plaintextCode }
  } catch {
    return { ok: false, reason: 'transaction_failed' }
  }
}

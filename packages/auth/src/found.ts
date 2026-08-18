/**
 * Founding-admin server logic.
 *
 * Founding is the passcode-first "Generate token" flow: on a fresh install
 * (`admins` empty), `claimFoundingAdmin()` creates the first admin with a
 * generated `lipc_` passcode (no passkey) and signs them in; the UI then
 * enrolls a passkey via the authenticated register flow. First claim wins.
 *
 * The DB writes go through the seam-tested `foundFirstAdmin` core
 * (`found-core.ts`) backed by the Drizzle `FoundingStore` built below.
 */

import { db } from '@lucidindex/db/client'
import { admins, credentials, recoveryCodes } from '@lucidindex/db/schema'
import { isDevAuthBypassActive } from './dev-bypass.js'
import { type FoundingStore, foundFirstAdmin, isAdminsTableEmpty } from './found-core.js'
import { PASSCODE_SESSION_MARKER } from './passcode-login.js'
import { generatePlaintextCode, hashCode } from './recovery.js'
import { establishSession } from './session.js'

/**
 * Minimal slice of the Drizzle client used by this module — covers both
 * the top-level `db` and the per-transaction handle Drizzle's
 * `db.transaction(tx => ...)` callback receives. Drizzle's transaction
 * type doesn't structurally satisfy `PostgresJsDatabase` (it's missing
 * `$client`), so we narrow to just the methods we actually call.
 */
type DrizzleHandle = {
  select: typeof db.select
  insert: typeof db.insert
  transaction: typeof db.transaction
}

function buildStore(handle: DrizzleHandle): FoundingStore {
  return {
    async countAdminsIsZero() {
      const rows = await handle.select({ id: admins.id }).from(admins).limit(1)
      return rows.length === 0
    },
    async insertAdmin({ name, foundingTokenHash }) {
      const inserted = await handle
        .insert(admins)
        .values({ name, foundingTokenHash })
        .returning({ id: admins.id })
      const id = inserted[0]?.id
      if (!id) throw new Error('admin insert returned no id')
      return id
    },
    async insertCredential({ adminId, credential }) {
      await handle.insert(credentials).values({
        adminId,
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        signCount: credential.signCount,
        deviceLabel: credential.deviceLabel,
      })
    },
    async insertRecoveryCode({ adminId, codeHash }) {
      await handle.insert(recoveryCodes).values({ adminId, codeHash })
    },
    async withTransaction(fn) {
      return handle.transaction(async (tx) => {
        const txStore: FoundingStore = {
          ...buildStore(tx as unknown as DrizzleHandle),
          // Inside the tx, withTransaction is a no-op pass-through —
          // nesting would open a savepoint which we don't need here.
          async withTransaction(inner) {
            return inner(txStore)
          },
        }
        return fn(txStore)
      })
    },
  }
}

/**
 * Build a Drizzle-backed `FoundingStore`. Defaults to the shared
 * `@lucidindex/db` client; tests and one-off scripts can pass a custom
 * Drizzle handle.
 */
export function makeDrizzleFoundingStore(database: DrizzleHandle = db): FoundingStore {
  return buildStore(database)
}

/** Public read for "should we render the founding form?". */
export async function isFoundingFlowAvailable(): Promise<boolean> {
  // When the dev bypass is active, skip the founding gate entirely —
  // bypass mode synthesizes a valid session, so the admins table being
  // empty is irrelevant and redirecting to /settings/found would break
  // the developer experience.
  if (isDevAuthBypassActive()) return false
  return isAdminsTableEmpty(makeDrizzleFoundingStore())
}

export type ClaimFoundingAdminResult =
  | { ok: true; adminId: string; passcode: string }
  | { ok: false; reason: 'not_available' | 'tx_failed' }

/**
 * Passcode-first founding (the "Generate token" flow).
 *
 * Creates the first admin with a freshly generated passcode (the reusable
 * `lipc_` backup-login secret) and NO passkey yet, then mints a session so the
 * caller can immediately enroll a passkey through the authenticated
 * `/api/auth/passkey/register/*` flow — no separate login. The plaintext
 * passcode is returned for one-time display.
 *
 * Gate: founding is open only while `admins` is empty. The check is enforced
 * twice — a cheap `isFoundingFlowAvailable()` read up front (also honours the
 * dev bypass), and `foundFirstAdmin`'s authoritative in-transaction
 * empty-table recheck. First claim wins; concurrent losers get `tx_failed`.
 *
 * There is no token gate: an unset `LUCIDINDEX_FOUNDING_TOKEN` no longer
 * disables founding. The deployment's protection is "the admins table is empty
 * exactly once" — whoever claims first becomes the sole admin.
 */
export async function claimFoundingAdmin(input?: {
  name?: string
}): Promise<ClaimFoundingAdminResult> {
  if (!(await isFoundingFlowAvailable())) {
    return { ok: false, reason: 'not_available' }
  }

  const name = (input?.name ?? '').trim() || 'Admin'
  const passcode = generatePlaintextCode()
  const hashedRecovery = await hashCode(passcode)

  // No `credential` → `foundFirstAdmin` records a passkey-less admin + the
  // hashed passcode, atomically, re-checking the empty table inside the tx.
  const result = await foundFirstAdmin(makeDrizzleFoundingStore(), {
    name,
    hashedRecoveryCode: hashedRecovery,
  })

  if (!result.ok) {
    return { ok: false, reason: 'tx_failed' }
  }

  // Mint a passcode-origin session so the new admin can enroll a passkey via
  // the authenticated register endpoint. Safe to set the cookie here: this
  // runs in a route handler (a plain fetch), not a server action, so it does
  // not trigger an RSC refresh that would unmount the claim card.
  await establishSession({ adminId: result.adminId, credentialId: PASSCODE_SESSION_MARKER })

  return { ok: true, adminId: result.adminId, passcode }
}

/**
 * Founding-admin server actions.
 *
 * Ported from Project-Showalter (`src/features/auth/found.ts`), adapted for:
 *   - Postgres + drizzle-orm/postgres-js (async transactions, no SQLite)
 *   - LucidIndex's leaner admin schema (no email column)
 *   - iron-session sessions (no Auth.js shim)
 *   - the `preCheck` seam — #27 will pass an env-var guard through this
 *     module's `foundingTokenPreCheck` parameter
 *
 * Three-step WebAuthn ceremony, mirroring Showalter:
 *
 *   1. `startFoundingEnrollment(deviceLabel)` — returns registration options
 *      ONLY if the admins table is empty.
 *   2. `finishFoundingEnrollment({ name, deviceLabel, response })` — verifies
 *      the attestation, then atomically inserts the admin + credential +
 *      hashed recovery code. Returns the plaintext recovery code so the
 *      client can render the one-time-display modal. Does NOT mint a session.
 *   3. `finalizeFoundingSession({ adminId, credentialId })` — called by the
 *      client after the recovery-code modal is dismissed. Mints the session.
 *
 * Why session minting is deferred to step 3: setting an iron-session cookie
 * mid-RSC triggers a refresh which would unmount the founding form before
 * the client can render the recovery-code modal — the user would lose the
 * one-time code. (Same root cause as Showalter, same solution.)
 *
 * Rate limiting and challenge storage are NOT included in this port —
 * Showalter's `lib/rate-limit` and in-memory challenge store are
 * application-level concerns. The route handlers in `apps/web` (#20) wrap
 * these primitives with the bits they need.
 */

import { db } from '@lucidindex/db/client'
import { admins, credentials, recoveryCodes } from '@lucidindex/db/schema'
import {
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import {
  type FoundingPreCheck,
  type FoundingStore,
  foundFirstAdmin,
  isAdminsTableEmpty,
} from './found-core.js'
import { generatePlaintextCode, hashCode } from './recovery.js'
import { establishSession, getSession } from './session.js'
import { getRelyingParty } from './webauthn.js'

/**
 * How long after `admins.created_at` finalize will still mint a session.
 * Caps the replay window on a stolen `{adminId, credentialId}` tuple. 10
 * minutes mirrors Showalter — generous enough that a distracted user
 * reading the recovery code aloud doesn't time out.
 */
const FOUNDING_FINALIZE_MAX_AGE_MS = 10 * 60_000

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
  return isAdminsTableEmpty(makeDrizzleFoundingStore())
}

export type StartFoundingEnrollmentResult =
  | { ok: true; options: Awaited<ReturnType<typeof generateRegistrationOptions>> }
  | { ok: false }

/**
 * Step 1: returns registration options for the browser, or `{ ok: false }`
 * if the table is non-empty. The caller (route handler) is responsible for
 * stashing `options.challenge` in a short-lived store keyed by some
 * client-stable value (session id, request fingerprint, etc.) and
 * supplying it back in step 2 as `expectedChallenge`.
 */
export async function startFoundingEnrollment(
  deviceLabel: string,
): Promise<StartFoundingEnrollmentResult> {
  if (!(await isFoundingFlowAvailable())) {
    return { ok: false }
  }

  const { rpID, rpName } = getRelyingParty()
  // userName / userDisplayName are required by the WebAuthn spec but they
  // don't have to be a real email — single-admin LucidIndex uses the
  // device label so the OS-level passkey UI shows something meaningful.
  const safeLabel = deviceLabel.trim() || 'LucidIndex Admin'
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: safeLabel,
    userDisplayName: safeLabel,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  return { ok: true, options }
}

export type FinishFoundingEnrollmentInput = {
  name: string
  deviceLabel: string
  response: RegistrationResponseJSON
  expectedChallenge: string
  /**
   * Optional — #27's founding-token guard plugs in here. The hook runs
   * inside the transaction, after the empty-check, before any insert.
   */
  foundingTokenPreCheck?: FoundingPreCheck
  /**
   * Optional — value to persist in `admins.founding_token_hash`. #27
   * supplies the hash of `LUCIDINDEX_FOUNDING_TOKEN`; this module just
   * passes it through.
   */
  foundingTokenHash?: string
}

export type FinishFoundingEnrollmentResult =
  | { ok: true; adminId: string; credentialId: string; recoveryCode: string }
  | { ok: false; reason: 'verify_failed' | 'tx_failed' }

/**
 * Step 2: verify the WebAuthn attestation, persist the admin + credential
 * + hashed recovery code in one transaction, and return the plaintext
 * recovery code for one-time client display.
 *
 * Does NOT mint a session — that's step 3 (`finalizeFoundingSession`).
 */
export async function finishFoundingEnrollment(
  input: FinishFoundingEnrollmentInput,
): Promise<FinishFoundingEnrollmentResult> {
  const trimmedName = input.name.trim()
  if (trimmedName.length === 0 || trimmedName.length > 100) {
    return { ok: false, reason: 'verify_failed' }
  }
  const trimmedLabel = input.deviceLabel.trim() || 'LucidIndex Admin'

  const { rpID, origin } = getRelyingParty()
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    })
  } catch {
    return { ok: false, reason: 'verify_failed' }
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: 'verify_failed' }
  }

  const cred = verification.registrationInfo.credential

  const plaintextRecovery = generatePlaintextCode()
  const hashedRecovery = await hashCode(plaintextRecovery)

  const result = await foundFirstAdmin(
    makeDrizzleFoundingStore(),
    {
      name: trimmedName,
      credential: {
        credentialId: cred.id,
        publicKey: new Uint8Array(cred.publicKey),
        signCount: BigInt(cred.counter),
        deviceLabel: trimmedLabel,
      },
      hashedRecoveryCode: hashedRecovery,
      ...(input.foundingTokenHash !== undefined
        ? { foundingTokenHash: input.foundingTokenHash }
        : {}),
    },
    input.foundingTokenPreCheck ? { preCheck: input.foundingTokenPreCheck } : undefined,
  )

  if (!result.ok) {
    return { ok: false, reason: 'tx_failed' }
  }

  return {
    ok: true,
    adminId: result.adminId,
    credentialId: cred.id,
    recoveryCode: plaintextRecovery,
  }
}

export type FinalizeFoundingSessionResult =
  | { ok: true }
  | { ok: false; reason: 'already_authenticated' | 'admin_not_found' | 'stale' | 'mismatch' }

/**
 * Step 3: mint the iron-session cookie. Refuses if the caller already has
 * a session, if the admin row is gone, if the credential doesn't belong
 * to that admin, or if `admins.created_at` is older than
 * `FOUNDING_FINALIZE_MAX_AGE_MS` (the replay-window cap).
 */
export async function finalizeFoundingSession(input: {
  adminId: string
  credentialId: string
}): Promise<FinalizeFoundingSessionResult> {
  if (
    typeof input?.adminId !== 'string' ||
    input.adminId.length === 0 ||
    typeof input?.credentialId !== 'string' ||
    input.credentialId.length === 0
  ) {
    return { ok: false, reason: 'mismatch' }
  }

  const existing = await getSession()
  if (existing.adminId) {
    return { ok: false, reason: 'already_authenticated' }
  }

  const adminRows = await db.select().from(admins).where(eq(admins.id, input.adminId)).limit(1)
  const admin = adminRows[0]
  if (!admin) {
    return { ok: false, reason: 'admin_not_found' }
  }

  const ageMs = Date.now() - admin.createdAt.getTime()
  if (ageMs > FOUNDING_FINALIZE_MAX_AGE_MS) {
    return { ok: false, reason: 'stale' }
  }

  const credRows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, input.credentialId))
    .limit(1)
  const cred = credRows[0]
  if (!cred || cred.adminId !== admin.id) {
    return { ok: false, reason: 'mismatch' }
  }

  await establishSession({ adminId: admin.id, credentialId: cred.credentialId })
  return { ok: true }
}

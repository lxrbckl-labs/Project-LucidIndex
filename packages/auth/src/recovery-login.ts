/**
 * Recovery-code login — Drizzle/WebAuthn glue over `recovery-login-core.ts`.
 *
 * Three-step ceremony, mirroring the founding flow's finish/finalize split:
 *
 *   1. `startRecoveryEnrollment(code, deviceLabel)` — verify the recovery code,
 *      and if it matches, return WebAuthn registration options for enrolling a
 *      NEW passkey on the current device. The caller stashes
 *      `options.challenge` and returns the token to the client.
 *   2. `finishRecoveryEnrollment({ code, deviceLabel, response, expectedChallenge })`
 *      — verify the attestation, then atomically burn the recovery code,
 *      enroll the credential, and issue a fresh recovery code. Returns the new
 *      plaintext code for one-time display. Does NOT mint a session.
 *   3. `finalizeRecoverySession({ adminId, credentialId })` — called after the
 *      new-recovery-code modal is dismissed. Mints the session, bounded by the
 *      freshly-enrolled credential's age.
 *
 * The recovery code is re-verified in step 2 (not trusted from step 1): it is
 * the only secret binding the ceremony, so consumption must be atomic with a
 * fresh check. The new-passkey enrollment is the recovery — a session is only
 * minted for a credential that was just created here.
 */

import { db } from '@lucidindex/db/client'
import { admins, authEvents, credentials, recoveryCodes } from '@lucidindex/db/schema'
import {
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { and, eq, isNull } from 'drizzle-orm'
import { generatePlaintextCode, hashCode, verifyHash } from './recovery.js'
import { findAdminForCode, type RecoveryStore, redeemRecoveryCode } from './recovery-login-core.js'
import { establishSession, getSession } from './session.js'
import { getRelyingParty } from './webauthn.js'

/** Default label for the passkey enrolled during recovery. */
const DEFAULT_DEVICE_LABEL = 'Recovered device'

/**
 * How long after the new credential's `created_at` finalize will still mint a
 * session. Caps the replay window on a stolen `{adminId, credentialId}` tuple.
 * Mirrors the founding flow's 10-minute window.
 */
const RECOVERY_FINALIZE_MAX_AGE_MS = 10 * 60_000

/**
 * Minimal slice of the Drizzle client used here — covers both the top-level
 * `db` and the per-transaction handle. Same narrowing as `found.ts`.
 */
type DrizzleHandle = {
  select: typeof db.select
  insert: typeof db.insert
  update: typeof db.update
  transaction: typeof db.transaction
}

function buildRecoveryStore(handle: DrizzleHandle): RecoveryStore {
  return {
    async listUnconsumedCodes() {
      const rows = await handle
        .select({
          id: recoveryCodes.id,
          adminId: recoveryCodes.adminId,
          codeHash: recoveryCodes.codeHash,
        })
        .from(recoveryCodes)
        .where(isNull(recoveryCodes.consumedAt))
      return rows
    },
    async consumeCode(id) {
      // Conditional consume: only stamps rows still unconsumed, so concurrent
      // redemptions of the same code can't both succeed.
      const consumed = await handle
        .update(recoveryCodes)
        .set({ consumedAt: new Date() })
        .where(and(eq(recoveryCodes.id, id), isNull(recoveryCodes.consumedAt)))
        .returning({ id: recoveryCodes.id })
      return consumed.length > 0
    },
    async insertCredential(input) {
      await handle.insert(credentials).values({
        adminId: input.adminId,
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        signCount: input.signCount,
        deviceLabel: input.deviceLabel,
      })
    },
    async insertRecoveryCode(input) {
      await handle.insert(recoveryCodes).values({
        adminId: input.adminId,
        codeHash: input.codeHash,
      })
    },
    async logEvent(input) {
      await handle.insert(authEvents).values({
        adminId: input.adminId,
        kind: input.kind,
        details: input.details,
      })
    },
    async withTransaction(fn) {
      return handle.transaction(async (tx) => {
        const txStore: RecoveryStore = {
          ...buildRecoveryStore(tx as unknown as DrizzleHandle),
          async withTransaction(inner) {
            return inner(txStore)
          },
        }
        return fn(txStore)
      })
    },
  }
}

export function makeDrizzleRecoveryStore(database: DrizzleHandle = db): RecoveryStore {
  return buildRecoveryStore(database)
}

export type StartRecoveryEnrollmentResult =
  | { ok: true; options: Awaited<ReturnType<typeof generateRegistrationOptions>> }
  | { ok: false; reason: 'invalid_code' | 'generate_failed' }

/**
 * Step 1: verify the recovery code and, if valid, generate registration
 * options for a new passkey scoped to the recovered admin's identity.
 */
export async function startRecoveryEnrollment(
  code: string,
  deviceLabel: string = DEFAULT_DEVICE_LABEL,
): Promise<StartRecoveryEnrollmentResult> {
  const match = await findAdminForCode(makeDrizzleRecoveryStore(), verifyHash, code)
  if (!match.ok) {
    return { ok: false, reason: 'invalid_code' }
  }

  const { rpID, rpName } = getRelyingParty()
  const safeLabel = deviceLabel.trim() || DEFAULT_DEVICE_LABEL

  try {
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      // Same WebAuthn user handle (admin id) so the browser associates the
      // new credential with the existing account identity.
      userID: new TextEncoder().encode(match.adminId),
      userName: safeLabel,
      userDisplayName: safeLabel,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    })
    return { ok: true, options }
  } catch {
    return { ok: false, reason: 'generate_failed' }
  }
}

export type FinishRecoveryEnrollmentInput = {
  code: string
  deviceLabel?: string
  response: RegistrationResponseJSON
  expectedChallenge: string
}

export type FinishRecoveryEnrollmentResult =
  | { ok: true; adminId: string; credentialId: string; recoveryCode: string }
  | { ok: false; reason: 'verify_failed' | 'invalid_code' | 'raced' | 'tx_failed' }

/**
 * Step 2: verify the attestation, then burn the recovery code + enroll the new
 * credential + issue a fresh code in one transaction. Returns the new plaintext
 * recovery code for one-time display. Does NOT mint a session.
 */
export async function finishRecoveryEnrollment(
  input: FinishRecoveryEnrollmentInput,
): Promise<FinishRecoveryEnrollmentResult> {
  const { rpID, origin } = getRelyingParty()
  const deviceLabel = (input.deviceLabel ?? DEFAULT_DEVICE_LABEL).trim() || DEFAULT_DEVICE_LABEL

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
  const newCodeHash = await hashCode(plaintextRecovery)

  let result: Awaited<ReturnType<typeof redeemRecoveryCode>>
  try {
    result = await redeemRecoveryCode(makeDrizzleRecoveryStore(), verifyHash, {
      code: input.code,
      credential: {
        credentialId: cred.id,
        publicKey: new Uint8Array(cred.publicKey),
        signCount: BigInt(cred.counter),
        deviceLabel,
      },
      newCodeHash,
    })
  } catch {
    return { ok: false, reason: 'tx_failed' }
  }

  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }

  return {
    ok: true,
    adminId: result.adminId,
    credentialId: result.credentialId,
    recoveryCode: plaintextRecovery,
  }
}

export type FinalizeRecoverySessionResult =
  | { ok: true }
  | { ok: false; reason: 'already_authenticated' | 'admin_not_found' | 'stale' | 'mismatch' }

/**
 * Step 3: mint the iron-session cookie. Refuses if the caller already has a
 * session, if the admin row is gone, if the credential doesn't belong to that
 * admin, or if the credential was created longer ago than
 * `RECOVERY_FINALIZE_MAX_AGE_MS` (the replay-window cap). Unlike founding's
 * finalize — which bounds on `admins.created_at` — recovery happens against an
 * existing (old) admin, so the freshly-enrolled credential's age is the bound.
 */
export async function finalizeRecoverySession(input: {
  adminId: string
  credentialId: string
}): Promise<FinalizeRecoverySessionResult> {
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

  const credRows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, input.credentialId))
    .limit(1)
  const cred = credRows[0]
  if (!cred || cred.adminId !== admin.id) {
    return { ok: false, reason: 'mismatch' }
  }

  const ageMs = Date.now() - cred.createdAt.getTime()
  if (ageMs > RECOVERY_FINALIZE_MAX_AGE_MS) {
    return { ok: false, reason: 'stale' }
  }

  await establishSession({ adminId: admin.id, credentialId: cred.credentialId })
  return { ok: true }
}

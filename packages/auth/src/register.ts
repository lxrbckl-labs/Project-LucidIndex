/**
 * Additional passkey registration flow.
 *
 * Used by the Settings → Account panel to let an already-authenticated admin
 * enroll a second (or further) passkey on their account. Distinct from the
 * founding flow (`found.ts`) which claims the very first admin slot.
 *
 * Two-step WebAuthn ceremony:
 *   1. `startPasskeyRegistration(adminId, deviceLabel)` — generates
 *      registration options for the admin's existing session. The caller
 *      stashes `options.challenge` in the challenge store and returns the
 *      token to the client.
 *   2. `finishPasskeyRegistration({ adminId, deviceLabel, response,
 *      expectedChallenge })` — verifies the attestation, inserts a new
 *      `credentials` row, and logs `passkey_register` to `auth_events`.
 */

import { db } from '@lucidindex/db/client'
import { authEvents, credentials } from '@lucidindex/db/schema'
import {
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { getRelyingParty } from './webauthn.js'

export type StartPasskeyRegistrationResult =
  | { ok: true; options: Awaited<ReturnType<typeof generateRegistrationOptions>> }
  | { ok: false; reason: string }

/**
 * Step 1: generate registration options for an authenticated admin.
 *
 * The `adminId` comes from the session — the caller is responsible for
 * verifying the session before calling this. The caller must stash
 * `options.challenge` in the challenge store and return the token to the
 * client so step 2 can redeem it.
 */
export async function startPasskeyRegistration(
  adminId: string,
  deviceLabel: string,
): Promise<StartPasskeyRegistrationResult> {
  if (!adminId || !deviceLabel.trim()) {
    return { ok: false, reason: 'invalid_input' }
  }

  const { rpID, rpName } = getRelyingParty()
  const safeLabel = deviceLabel.trim()

  try {
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      // Use the admin's id as the WebAuthn user handle so the browser
      // associates the new credential with the same account identity.
      userID: new TextEncoder().encode(adminId),
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

export type FinishPasskeyRegistrationInput = {
  adminId: string
  deviceLabel: string
  response: RegistrationResponseJSON
  expectedChallenge: string
}

export type FinishPasskeyRegistrationResult =
  | { ok: true; credentialId: string }
  | { ok: false; reason: 'verify_failed' | 'persist_failed' }

/**
 * Step 2: verify the attestation and persist the new credential row.
 *
 * Inserts into `credentials` (scoped to the existing `adminId`) and logs
 * a `passkey_register` event to `auth_events`.
 */
export async function finishPasskeyRegistration(
  input: FinishPasskeyRegistrationInput,
): Promise<FinishPasskeyRegistrationResult> {
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

  try {
    await db.insert(credentials).values({
      adminId: input.adminId,
      credentialId: cred.id,
      publicKey: new Uint8Array(cred.publicKey),
      signCount: BigInt(cred.counter),
      deviceLabel: input.deviceLabel.trim(),
    })

    await db.insert(authEvents).values({
      adminId: input.adminId,
      kind: 'passkey_register',
      details: { credentialId: cred.id, deviceLabel: input.deviceLabel.trim() },
    })

    return { ok: true, credentialId: cred.id }
  } catch {
    return { ok: false, reason: 'persist_failed' }
  }
}

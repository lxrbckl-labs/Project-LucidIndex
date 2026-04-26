/**
 * Passkey login flow.
 *
 * Ported from Project-Showalter (`src/features/auth/login.ts`), adapted for
 * single-admin LucidIndex:
 *   - No email lookup. There's exactly one admin row; we list its
 *     credentials and let the browser pick one. (Showalter classifies the
 *     admin by email because it was originally multi-admin-capable.)
 *   - Postgres + drizzle-orm/postgres-js
 *   - iron-session sessions
 *   - sign_count is `bigint` (mirrors the schema)
 *
 * Two-step ceremony:
 *   1. `startLogin()` — returns authentication options for the browser.
 *      Refuses if no admin is enrolled yet.
 *   2. `finishLogin({ response, expectedChallenge })` — verifies the
 *      assertion, bumps the credential counter, mints an iron-session
 *      cookie.
 *
 * Challenge storage and rate limiting live in the consuming app (#20),
 * same separation-of-concerns as `found.ts`.
 */

import { db } from '@lucidindex/db/client'
import { admins, credentials } from '@lucidindex/db/schema'
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { establishSession } from './session.js'
import { getRelyingParty } from './webauthn.js'

export type StartLoginResult =
  | { ok: true; options: Awaited<ReturnType<typeof generateAuthenticationOptions>> }
  | { ok: false; reason: 'no_admin' | 'no_credentials' }

/**
 * Step 1: build the WebAuthn authentication options. Returns
 * `allowCredentials` populated with every credential id known for the
 * (single) admin so the browser can preselect.
 *
 * The caller must persist `options.challenge` somewhere short-lived
 * (per-request session, server-side memo) and supply it back as
 * `expectedChallenge` in step 2.
 */
export async function startLogin(): Promise<StartLoginResult> {
  const adminRows = await db.select({ id: admins.id }).from(admins).limit(1)
  const admin = adminRows[0]
  if (!admin) {
    return { ok: false, reason: 'no_admin' }
  }

  const creds = await db
    .select({ credentialId: credentials.credentialId })
    .from(credentials)
    .where(eq(credentials.adminId, admin.id))
  if (creds.length === 0) {
    // Edge case: admin row exists but no credentials registered. Treat as
    // "can't sign in" — covers the partial-enrollment window where step 2
    // of founding crashed before the credential row landed.
    return { ok: false, reason: 'no_credentials' }
  }

  const { rpID } = getRelyingParty()
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({ id: c.credentialId })),
    userVerification: 'preferred',
  })

  return { ok: true, options }
}

export type FinishLoginInput = {
  response: AuthenticationResponseJSON
  expectedChallenge: string
}

export type FinishLoginResult =
  | { ok: true; adminId: string; credentialId: string }
  | { ok: false; reason: 'no_admin' | 'credential_not_found' | 'verify_failed' }

/**
 * Step 2: verify the assertion. On success, bump the stored signature
 * counter (replay defence) and mint the iron-session cookie.
 */
export async function finishLogin(input: FinishLoginInput): Promise<FinishLoginResult> {
  const adminRows = await db.select().from(admins).limit(1)
  const admin = adminRows[0]
  if (!admin) {
    return { ok: false, reason: 'no_admin' }
  }

  const credRows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, input.response.id))
    .limit(1)
  const credRow = credRows[0]
  if (!credRow || credRow.adminId !== admin.id) {
    return { ok: false, reason: 'credential_not_found' }
  }

  const { rpID, origin } = getRelyingParty()
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credRow.credentialId,
        publicKey: new Uint8Array(credRow.publicKey),
        // sign_count is bigint in the schema, @simplewebauthn/server's
        // `counter` is a plain `number`. The actual values are well below
        // Number.MAX_SAFE_INTEGER for any realistic usage.
        counter: Number(credRow.signCount),
      },
      requireUserVerification: false,
    })
  } catch {
    return { ok: false, reason: 'verify_failed' }
  }

  if (!verification.verified) {
    return { ok: false, reason: 'verify_failed' }
  }

  // Bump sign_count to the new value the authenticator reported. This is the
  // primary defence against a cloned authenticator: a clone replaying an old
  // assertion will carry a counter <= the stored value.
  await db
    .update(credentials)
    .set({ signCount: BigInt(verification.authenticationInfo.newCounter) })
    .where(eq(credentials.id, credRow.id))

  await establishSession({ adminId: admin.id, credentialId: credRow.credentialId })
  return { ok: true, adminId: admin.id, credentialId: credRow.credentialId }
}

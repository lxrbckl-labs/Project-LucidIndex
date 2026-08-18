/**
 * Forum-user passkey login.
 *
 * Mirrors `login.ts` (admin) but for the multi-user forum surface, with
 * three structural differences:
 *
 *   1. Discoverable credentials. The forum has many users; we don't
 *      know who is signing in until the assertion comes back. We omit
 *      `allowCredentials` so the browser shows every passkey it has
 *      for this RP and the user picks one. Phase D signup MUST register
 *      forum credentials with `residentKey: 'required'` (resident keys)
 *      so this discovery path actually finds them.
 *
 *   2. Kill-switch enforcement. The invite that minted the user (joined
 *      via `forum_invites.redeemed_by_user_id`) must have a NULL
 *      `revoked_at`. This is what makes "Revoke access" in the admin
 *      panel actually lock a user out — not just block future signup.
 *      No invite anchor → refuse (data integrity guard, shouldn't happen
 *      after Phase D wires atomic redemption, but cheap to check).
 *
 *   3. Separate session cookie (`li-forum-session`) so admin and forum
 *      identities can coexist on one browser without conflict.
 *
 * Two-step ceremony:
 *   1. `startForumLogin()` — returns options for `startAuthentication`.
 *   2. `finishForumLogin({ response, expectedChallenge })` — verifies
 *      the assertion, runs the kill-switch check, bumps sign_count,
 *      mints the forum session cookie.
 *
 * Challenge storage stays in the consuming app's challenge-store
 * (in-memory, sub-minute TTL).
 */

import { db } from '@lucidindex/db/client'
import { forumCredentials, forumInvites, forumUsers } from '@lucidindex/db/schema'
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import { establishForumSession } from './forum-session.js'
import { getRelyingParty } from './webauthn.js'

export type StartForumLoginResult = {
  ok: true
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>
}

/**
 * Step 1: build the WebAuthn authentication options. We omit
 * `allowCredentials` so the browser uses discoverable credentials —
 * the user sees every passkey they have for this RP and picks one.
 */
export async function startForumLogin(): Promise<StartForumLoginResult> {
  const { rpID } = getRelyingParty()
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  })
  return { ok: true, options }
}

export type FinishForumLoginInput = {
  response: AuthenticationResponseJSON
  expectedChallenge: string
}

export type FinishForumLoginResult =
  | {
      ok: true
      forumUserId: string
      credentialId: string
      username: string
    }
  | {
      ok: false
      reason: 'credential_not_found' | 'verify_failed' | 'access_revoked' | 'no_invite_anchor'
    }

/**
 * Step 2: verify the assertion. Resolve which forum_user owns the
 * presented credential, confirm their invite isn't revoked, then verify
 * the signature, bump the counter, and mint the session.
 */
export async function finishForumLogin(
  input: FinishForumLoginInput,
): Promise<FinishForumLoginResult> {
  // 1. Resolve credential → forum user.
  const credRows = await db
    .select({
      id: forumCredentials.id,
      userId: forumCredentials.userId,
      credentialId: forumCredentials.credentialId,
      publicKey: forumCredentials.publicKey,
      signCount: forumCredentials.signCount,
    })
    .from(forumCredentials)
    .where(eq(forumCredentials.credentialId, input.response.id))
    .limit(1)
  const credRow = credRows[0]
  if (!credRow) {
    return { ok: false, reason: 'credential_not_found' }
  }

  const userRows = await db
    .select({ id: forumUsers.id, username: forumUsers.username })
    .from(forumUsers)
    .where(eq(forumUsers.id, credRow.userId))
    .limit(1)
  const userRow = userRows[0]
  if (!userRow) {
    // Credential row dangling without a user — treat as unknown.
    return { ok: false, reason: 'credential_not_found' }
  }

  // 2. Kill-switch: the invite that minted this user must not be
  //    revoked. If somehow there's no invite anchor (data corruption
  //    or pre-Phase-D test seeding), refuse — login requires a valid
  //    invite tie-back.
  const inviteRows = await db
    .select({
      id: forumInvites.id,
      revokedAt: forumInvites.revokedAt,
    })
    .from(forumInvites)
    .where(eq(forumInvites.redeemedByUserId, userRow.id))
    .limit(1)
  const inviteRow = inviteRows[0]
  if (!inviteRow) {
    return { ok: false, reason: 'no_invite_anchor' }
  }
  if (inviteRow.revokedAt) {
    return { ok: false, reason: 'access_revoked' }
  }

  // 3. Verify the WebAuthn assertion.
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
        // sign_count is bigint in the schema; @simplewebauthn expects number.
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

  // 4. Bump sign_count (replay defence).
  await db
    .update(forumCredentials)
    .set({ signCount: BigInt(verification.authenticationInfo.newCounter) })
    .where(eq(forumCredentials.id, credRow.id))

  // 5. Mint the forum session.
  await establishForumSession({
    forumUserId: userRow.id,
    credentialId: credRow.credentialId,
  })

  return {
    ok: true,
    forumUserId: userRow.id,
    credentialId: credRow.credentialId,
    username: userRow.username,
  }
}

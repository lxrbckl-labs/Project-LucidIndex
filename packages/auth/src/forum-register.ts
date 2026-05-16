/**
 * Forum-user signup ceremony — Phase D, signup half.
 *
 * Mirrors the admin `register.ts` flow but for the multi-user forum
 * surface, with three meaningful differences:
 *
 *   1. Combines invite-code verification with passkey enrollment.
 *      Signup is invite-gated: the admin issues a single-use code,
 *      the user pastes it on `/forum`, and the same ceremony that
 *      verifies the code also creates the forum_user, redeems the
 *      invite, and persists the new credential.
 *
 *   2. Atomicity. User creation + invite redemption + credential
 *      insertion run in a single Drizzle transaction. The invite
 *      redemption is a conditional UPDATE (`WHERE redeemed_at IS NULL
 *      AND revoked_at IS NULL`) so two simultaneous redemptions of the
 *      same code can't both succeed — one wins, the other rolls back
 *      with `invite_consumed`.
 *
 *   3. Discoverable credentials. `residentKey: 'required'` so the
 *      passkey is enrolled as a resident key. That's what makes
 *      `startForumLogin` work without `allowCredentials` — the browser
 *      can find the right passkey via discovery instead of the server
 *      having to enumerate.
 *
 * Two-step ceremony:
 *   1. `startForumRegistration({ code, username })` — validates the
 *      username shape, confirms the invite is still redeemable, builds
 *      WebAuthn registration options.
 *   2. `finishForumRegistration({ code, username, response,
 *      expectedChallenge })` — verifies the attestation, runs the
 *      atomic transaction, mints the forum session cookie.
 *
 * Challenge storage stays in the consuming app's challenge-store
 * (in-memory, sub-minute TTL).
 */

import { randomBytes } from 'node:crypto'
import { db } from '@lucidindex/db/client'
import { and, eq, gt, isNull, or, sql } from '@lucidindex/db/query'
import { forumCredentials, forumInvites, forumUsers } from '@lucidindex/db/schema'
import {
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { establishForumSession } from './forum-session.js'
import { hashCode as _unused, verifyHash as argonVerify } from './recovery.js'
import { getRelyingParty } from './webauthn.js'

// Silence the unused import — kept so future helpers can rehash if needed.
void _unused

/**
 * Same regex enforced by the `forum_users_username_check` CHECK
 * constraint at the DB level. Mirrored in code so we can give the user
 * a precise error message before the round-trip.
 */
export const FORUM_USERNAME_RE = /^[a-z][a-z0-9_-]{2,19}$/

/** Default device label stamped on the new credential row. */
const DEFAULT_DEVICE_LABEL = 'Forum passkey'

async function findRedeemableInviteId(code: string): Promise<string | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  // Same "available" predicate as `checkInviteCode` in the app repo,
  // duplicated here so this package stays independent of app code.
  const candidates = await db
    .select({
      id: forumInvites.id,
      codeHash: forumInvites.codeHash,
    })
    .from(forumInvites)
    .where(
      and(
        isNull(forumInvites.redeemedAt),
        isNull(forumInvites.revokedAt),
        or(isNull(forumInvites.expiresAt), gt(forumInvites.expiresAt, new Date())),
      ),
    )

  for (const c of candidates) {
    if (await argonVerify(trimmed, c.codeHash)) return c.id
  }
  return null
}

export type StartForumRegistrationResult =
  | {
      ok: true
      options: Awaited<ReturnType<typeof generateRegistrationOptions>>
    }
  | {
      ok: false
      reason: 'invalid_username' | 'username_taken' | 'invalid_invite' | 'generate_failed'
    }

export async function startForumRegistration(input: {
  code: string
  username: string
}): Promise<StartForumRegistrationResult> {
  const username = input.username.trim().toLowerCase()
  if (!FORUM_USERNAME_RE.test(username)) {
    return { ok: false, reason: 'invalid_username' }
  }

  // Soft pre-check on availability. The atomic insert in finish is the
  // race-safe authority — this check just gives a faster failure path
  // when the username is obviously taken.
  const existing = await db
    .select({ id: forumUsers.id })
    .from(forumUsers)
    .where(eq(forumUsers.username, username))
    .limit(1)
  if (existing.length > 0) {
    return { ok: false, reason: 'username_taken' }
  }

  const inviteId = await findRedeemableInviteId(input.code)
  if (!inviteId) {
    return { ok: false, reason: 'invalid_invite' }
  }

  const { rpID, rpName } = getRelyingParty()
  // WebAuthn userID is the handle the authenticator stores. We don't
  // have a forum_user row yet — generate a random handle now; the row
  // gets created at finish time with the credential pointing at it.
  const userIdHandle = randomBytes(16).toString('base64url')

  try {
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(userIdHandle),
      userName: username,
      userDisplayName: username,
      attestationType: 'none',
      authenticatorSelection: {
        // CRITICAL: resident keys are what makes the discoverable-
        // credential signin flow work. Without this, `startForumLogin`
        // (which omits allowCredentials) can't find this passkey.
        residentKey: 'required',
        userVerification: 'preferred',
      },
    })
    return { ok: true, options }
  } catch {
    return { ok: false, reason: 'generate_failed' }
  }
}

export type FinishForumRegistrationInput = {
  code: string
  username: string
  response: RegistrationResponseJSON
  expectedChallenge: string
}

export type FinishForumRegistrationResult =
  | { ok: true; forumUserId: string; username: string; credentialId: string }
  | {
      ok: false
      reason:
        | 'invalid_username'
        | 'username_taken'
        | 'invalid_invite'
        | 'invite_consumed'
        | 'verify_failed'
        | 'persist_failed'
    }

export async function finishForumRegistration(
  input: FinishForumRegistrationInput,
): Promise<FinishForumRegistrationResult> {
  const username = input.username.trim().toLowerCase()
  if (!FORUM_USERNAME_RE.test(username)) {
    return { ok: false, reason: 'invalid_username' }
  }

  const inviteId = await findRedeemableInviteId(input.code)
  if (!inviteId) {
    return { ok: false, reason: 'invalid_invite' }
  }

  // Verify the attestation before touching the DB. If the WebAuthn
  // ceremony failed there's no point trying to create rows.
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

  const credential = verification.registrationInfo.credential

  // Atomic transaction:
  //   1. INSERT forum_users (DB unique constraint on username catches
  //      duplicates — throw a tagged error so we can rollback cleanly).
  //   2. UPDATE forum_invites ... WHERE id = $id AND redeemed_at IS NULL
  //      AND revoked_at IS NULL — only matches still-redeemable rows.
  //      Returns 0 rows if someone else won the race; we throw and roll
  //      back so we never end up with a user pointing at a non-redeemed
  //      invite.
  //   3. INSERT forum_credentials linking the new user to the verified
  //      WebAuthn credential.
  let newUserId: string
  try {
    newUserId = await db.transaction(async (tx) => {
      let userId: string
      try {
        const inserted = await tx
          .insert(forumUsers)
          .values({ username })
          .returning({ id: forumUsers.id })
        const row = inserted[0]
        if (!row) throw new Error('persist_failed')
        userId = row.id
      } catch (err) {
        // Postgres unique-violation code is 23505. drizzle-orm wraps
        // node-postgres errors but the original is reachable.
        const msg = err instanceof Error ? err.message : ''
        if (/duplicate key|unique constraint|23505/i.test(msg)) {
          throw new Error('username_taken')
        }
        throw err
      }

      const redeemed = await tx
        .update(forumInvites)
        .set({ redeemedAt: sql`now()`, redeemedByUserId: userId })
        .where(
          and(
            eq(forumInvites.id, inviteId),
            isNull(forumInvites.redeemedAt),
            isNull(forumInvites.revokedAt),
          ),
        )
        .returning({ id: forumInvites.id })
      if (redeemed.length === 0) {
        throw new Error('invite_consumed')
      }

      await tx.insert(forumCredentials).values({
        userId,
        credentialId: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        signCount: BigInt(credential.counter),
        deviceLabel: DEFAULT_DEVICE_LABEL,
      })

      return userId
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'username_taken') return { ok: false, reason: 'username_taken' }
    if (msg === 'invite_consumed') return { ok: false, reason: 'invite_consumed' }
    return { ok: false, reason: 'persist_failed' }
  }

  // Mint the session OUTSIDE the transaction — cookie work touches
  // Next.js request headers, not the DB.
  await establishForumSession({
    forumUserId: newUserId,
    credentialId: credential.id,
  })

  return {
    ok: true,
    forumUserId: newUserId,
    username,
    credentialId: credential.id,
  }
}

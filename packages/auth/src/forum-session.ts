/**
 * iron-session helpers for forum users.
 *
 * Mirrors `session.ts` (admin) but for the multi-user forum surface.
 * Two reasons for a separate cookie + helper instead of extending the
 * admin session shape:
 *   1. Different subjects. An admin and a forum user are distinct
 *      principals — an admin shouldn't be auto-signed-in as a forum
 *      user just because they manage the instance.
 *   2. Different lifecycles. A forum user can be locked out via the
 *      invite kill-switch (`forum_invites.revoked_at IS NOT NULL`),
 *      independent of admin auth.
 *
 * Cookie:
 *   - name: `li-forum-session` (siblings the admin `li-session`)
 *   - same iron-session password (different cookie names → separate
 *     cipher streams; one secret is enough)
 *   - 30-day sliding TTL
 */

import { getIronSession, type IronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'

export const FORUM_SESSION_COOKIE_NAME = 'li-forum-session'
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60

/** Shape persisted in the forum iron-session cookie. */
export type ForumSessionData = {
  /** UUID from `forum_users.id`. Absent on a fresh cookie. */
  forumUserId?: string
  /** WebAuthn credential id (base64url) used to mint this session. */
  credentialId?: string
}

function forumSessionOptions(): SessionOptions {
  const password = process.env.IRON_SESSION_PASSWORD
  if (!password || password.length < 32) {
    throw new Error(
      'IRON_SESSION_PASSWORD must be set and at least 32 characters long. ' +
        'Generate one with `openssl rand -hex 32` and add it to .env.',
    )
  }
  return {
    password,
    cookieName: FORUM_SESSION_COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: THIRTY_DAYS_SECONDS,
    },
  }
}

export async function getForumSession(): Promise<IronSession<ForumSessionData>> {
  const jar = await cookies()
  return getIronSession<ForumSessionData>(jar, forumSessionOptions())
}

/**
 * Convenience guard: returns the session iff it carries a `forumUserId`.
 * Caller decides redirect / 401 policy.
 */
export async function requireForumUser(): Promise<IronSession<ForumSessionData> | null> {
  const session = await getForumSession()
  if (!session.forumUserId) return null
  return session
}

/**
 * Mint a forum session for the given forum user + credential. Called
 * from `finishForumLogin` after a verified ceremony.
 */
export async function establishForumSession(input: {
  forumUserId: string
  credentialId: string
}): Promise<void> {
  const session = await getForumSession()
  session.forumUserId = input.forumUserId
  session.credentialId = input.credentialId
  await session.save()
}

/** Destroy the current forum session cookie. Safe to call when none exists. */
export async function destroyForumSession(): Promise<void> {
  const session = await getForumSession()
  session.destroy()
}

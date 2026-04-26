/**
 * iron-session helpers for the LucidIndex admin shell.
 *
 * Showalter (the source of this port) ships a custom DB-backed session
 * manager glued to Auth.js's `users` / `sessions` tables. LucidIndex is
 * single-admin and doesn't need any of that — `iron-session` gives us a
 * signed, encrypted, stateless cookie that round-trips the admin id.
 *
 * The cookie payload deliberately carries `adminId` AND `credentialId`:
 *   - `adminId` lets `requireAdmin` resolve the admin row in one read.
 *   - `credentialId` lets future device-management features identify
 *     "this device" and invalidate the right session if a credential is
 *     removed (mirrors the Showalter `sessions.credentialId` field).
 *
 * Session shape choices:
 *   - cookie name: `li-session` — short, namespaced, doesn't clash with
 *     a future Auth.js cookie if we ever add one.
 *   - TTL: 30 days. iron-session re-encrypts on every response, so the
 *     cookie's max-age is effectively a sliding expiry as long as the
 *     user hits an authenticated route at least once per 30 days.
 *   - secure: on in production, off in dev (so http://localhost works).
 *   - sameSite: lax — same-origin POSTs (server actions) work, third-
 *     party redirects don't carry the session.
 *   - httpOnly: always — the client never needs to read the cookie.
 */

import { getIronSession, type IronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'

export const SESSION_COOKIE_NAME = 'li-session'
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60

/** Shape persisted in the iron-session cookie. */
export type SessionData = {
  /** UUID from `admins.id`. Absent on a fresh, unauthenticated cookie. */
  adminId?: string
  /** WebAuthn credential id (base64url) used to mint this session. */
  credentialId?: string
}

/**
 * Returns the iron-session config. Reads `IRON_SESSION_PASSWORD` lazily so
 * importing this module never crashes a build that hasn't set the env yet
 * (e.g. `next build` in CI without secrets); callers that actually issue or
 * read the cookie will fail at request time, which is the right place.
 */
function sessionOptions(): SessionOptions {
  const password = process.env.IRON_SESSION_PASSWORD
  if (!password || password.length < 32) {
    throw new Error(
      'IRON_SESSION_PASSWORD must be set and at least 32 characters long. ' +
        'Generate one with `openssl rand -hex 32` and add it to .env.',
    )
  }
  return {
    password,
    cookieName: SESSION_COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: THIRTY_DAYS_SECONDS,
    },
  }
}

/**
 * Read (or create-empty) the iron-session cookie for the current request.
 * The returned object is mutable — set `adminId` / `credentialId` and call
 * `.save()` to persist; call `.destroy()` to clear.
 *
 * Must be called from a Next.js server context (route handler, server
 * action, RSC) where `next/headers#cookies()` works.
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const jar = await cookies()
  return getIronSession<SessionData>(jar, sessionOptions())
}

/**
 * Convenience guard: return the session if it carries an `adminId`,
 * otherwise return null. Use in server components / actions that need an
 * "is the caller authenticated?" check without blowing up. Pages that
 * MUST be admin-only should follow the null with `redirect('/login')`
 * (or a 401 from a route handler) — that's a per-app policy decision so
 * we don't bake it in here.
 */
export async function requireAdmin(): Promise<IronSession<SessionData> | null> {
  const session = await getSession()
  if (!session.adminId) return null
  return session
}

/**
 * Mint a session for the given admin + credential. Wraps the iron-session
 * mutation + save so callers don't have to touch the cookie surface
 * directly. Called from the WebAuthn flows (`finishLogin`, founding
 * finalize) after a verified ceremony.
 */
export async function establishSession(input: {
  adminId: string
  credentialId: string
}): Promise<void> {
  const session = await getSession()
  session.adminId = input.adminId
  session.credentialId = input.credentialId
  await session.save()
}

/** Destroy the current session cookie. Safe to call when no session exists. */
export async function destroySession(): Promise<void> {
  const session = await getSession()
  session.destroy()
}

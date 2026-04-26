/**
 * In-memory WebAuthn challenge store.
 *
 * The `start` route handlers stash the challenge from `generateRegistration|
 * AuthenticationOptions()` here and hand the caller back a short opaque
 * token. The matching `finish` handler then redeems the token for the
 * stored challenge so it can be passed as `expectedChallenge` to the
 * SimpleWebAuthn verifier.
 *
 * Why a process-local Map (and not a DB column or Redis):
 *   - LucidIndex is single-node — there's no horizontal scale that would
 *     break process-local state.
 *   - The challenge lifecycle is sub-minute. A long-lived store would
 *     just be a memory leak.
 *   - Keeping it out of `admins` means the founding flow doesn't need a
 *     transient column on a row that may not exist yet.
 *   - Easy to swap to Redis / DB later without changing the `start`/
 *     `finish` route surface — the token-redeem contract stays the same.
 *
 * Tokens are short, opaque (random 16-byte hex), and consumed-on-redeem
 * so a captured token can't be replayed. Entries also expire after a
 * fixed TTL so abandoned ceremonies don't accumulate.
 *
 * Survival across `next dev` reloads is best-effort — the dev server
 * recreates the module which clears the Map, but the user just hits
 * "register" again. Production runs `next start` so the module is
 * stable for the life of the process.
 */

import { randomBytes } from 'node:crypto'

/** WebAuthn ceremonies are sub-minute; 5 minutes is generous. */
const CHALLENGE_TTL_MS = 5 * 60_000

type Entry = {
  challenge: string
  expiresAt: number
}

// Module-level Map — single instance per Node process. Next.js's dev
// HMR can re-evaluate route modules but the underlying module graph
// keeps this binding stable per worker.
const store = new Map<string, Entry>()

/** Drop expired entries opportunistically on every read/write. */
function sweep(now: number) {
  for (const [token, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(token)
    }
  }
}

/**
 * Stash `challenge` and return an opaque token the client carries
 * back to the matching `finish` route.
 */
export function stashChallenge(challenge: string): string {
  const now = Date.now()
  sweep(now)
  const token = randomBytes(16).toString('hex')
  store.set(token, { challenge, expiresAt: now + CHALLENGE_TTL_MS })
  return token
}

/**
 * Redeem a token, returning the stashed challenge once. Returns null if
 * the token is unknown, already consumed, or expired.
 */
export function redeemChallenge(token: string): string | null {
  const now = Date.now()
  sweep(now)
  const entry = store.get(token)
  if (!entry) return null
  store.delete(token)
  if (entry.expiresAt <= now) return null
  return entry.challenge
}

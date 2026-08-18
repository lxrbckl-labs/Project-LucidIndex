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

/**
 * WebAuthn ceremonies are sub-minute; 15 minutes leaves generous slack
 * for slow passkey sheets, password-manager prompts, or the user
 * pausing mid-ceremony. Production runs are typically much faster.
 */
const CHALLENGE_TTL_MS = 15 * 60_000

type Entry = {
  challenge: string
  expiresAt: number
}

// Pin the Map to globalThis. Next.js dev HMR re-evaluates route
// modules (and the modules they import) on file change OR on any
// random invalidation event the bundler decides to fire. A plain
// module-level `const store = new Map()` resets to empty on every
// re-eval — which manifests as "Signup timed out" on perfectly fresh
// passkey ceremonies, because /start stashes into one Map instance
// and /finish reads from a different one.
//
// globalThis survives module re-evaluation within the same V8 isolate
// (which dev mode keeps for the life of the worker), so the store is
// stable across HMR cycles.
// biome-ignore lint: TypeScript globalThis augmentation requires `var`
declare global {
  var __lucidindexChallengeStore: Map<string, Entry> | undefined
}

const store: Map<string, Entry> = globalThis.__lucidindexChallengeStore ?? new Map<string, Entry>()
globalThis.__lucidindexChallengeStore = store

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

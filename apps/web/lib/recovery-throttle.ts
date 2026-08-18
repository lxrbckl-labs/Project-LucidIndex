/**
 * In-memory attempt throttle for the recovery-code endpoint.
 *
 * The recovery code is the only secret protecting account takeover when
 * passkeys are lost, so the `recovery/start` route is the one auth surface a
 * brute-force attacker would hammer. argon2 already makes each guess slow and
 * the code carries ~60 bits of entropy, but a per-client attempt cap turns
 * "slow" into "pointless".
 *
 * Same process-local `globalThis`-pinned Map rationale as `challenge-store.ts`:
 * LucidIndex is single-node, the state is short-lived, and the Map survives
 * Next.js dev HMR re-evaluation (a plain module-level Map would reset to empty
 * on every re-eval and silently drop the throttle). Swappable for Redis later
 * without changing the call sites.
 */

/** Rolling window length. */
const WINDOW_MS = 15 * 60_000
/** Max attempts per client per window before the route returns 429. */
const MAX_ATTEMPTS = 10

type Bucket = { count: number; resetAt: number }

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSec: number }

// biome-ignore lint: TypeScript globalThis augmentation requires `var`
declare global {
  var __lucidindexRecoveryThrottle: Map<string, Bucket> | undefined
}

const store: Map<string, Bucket> = globalThis.__lucidindexRecoveryThrottle ?? new Map()
globalThis.__lucidindexRecoveryThrottle = store

/**
 * Pure decision step — visible for reasoning/testing. Given the current bucket
 * (or undefined) and the current time, returns whether the attempt is allowed
 * and the bucket state to persist.
 */
export function evaluateThrottle(
  bucket: Bucket | undefined,
  now: number,
): { decision: ThrottleDecision; next: Bucket } {
  if (!bucket || bucket.resetAt <= now) {
    return { decision: { allowed: true }, next: { count: 1, resetAt: now + WINDOW_MS } }
  }
  if (bucket.count >= MAX_ATTEMPTS) {
    return {
      decision: { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) },
      next: bucket,
    }
  }
  return { decision: { allowed: true }, next: { ...bucket, count: bucket.count + 1 } }
}

/**
 * Record an attempt for `key` (typically the client IP) and return whether it
 * is allowed. Counts every attempt, not just failures, so an attacker can't
 * dodge the cap by interleaving valid-looking requests.
 */
export function recordRecoveryAttempt(key: string): ThrottleDecision {
  const now = Date.now()
  const { decision, next } = evaluateThrottle(store.get(key), now)
  store.set(key, next)
  return decision
}

/** Clear a client's bucket — called after a successful recovery. */
export function clearRecoveryAttempts(key: string): void {
  store.delete(key)
}

/**
 * Best-effort client identity for throttling: the first `x-forwarded-for` hop
 * (the host Caddy sets this), falling back to `x-real-ip`, then a shared
 * `unknown` bucket. A shared bucket is acceptable here — it only ever
 * over-throttles, never under-throttles.
 */
export function clientKeyFromRequest(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

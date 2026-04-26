/**
 * Founding-token helpers for the LUCIDINDEX_FOUNDING_TOKEN env-var guard.
 *
 * Used by:
 *   - `apps/web/app/settings/found/page.tsx`  — route-level gate
 *   - `apps/web/app/api/auth/founding/finish/route.ts` — transaction-level preCheck
 *
 * Security notes:
 *   - Never log or echo the env-var value or any prefix/suffix of it.
 *   - All comparisons go through `timingSafeEqual` on sha-256 digests
 *     (fixed-width, so no length-timing oracle).
 */

import { createHash, timingSafeEqual } from 'node:crypto'

function sha256Hex(value: string): Buffer {
  return Buffer.from(createHash('sha256').update(value, 'utf8').digest())
}

/**
 * Returns true when `LUCIDINDEX_FOUNDING_TOKEN` is set to a non-empty
 * string in the environment.
 */
export function foundingTokenIsConfigured(): boolean {
  const t = process.env.LUCIDINDEX_FOUNDING_TOKEN
  return typeof t === 'string' && t.length > 0
}

/**
 * Constant-time comparison of a candidate token against the env var.
 *
 * Both sides are sha-256-hashed before comparison so the inputs to
 * `timingSafeEqual` are always the same length, eliminating a length-timing
 * oracle on the env-var value.
 *
 * Returns false if the env var is unset / empty, or if `candidate` is
 * nullish.
 */
export function foundingTokenMatches(candidate: string | undefined | null): boolean {
  if (!foundingTokenIsConfigured()) return false
  if (candidate === undefined || candidate === null) return false
  const envToken = process.env.LUCIDINDEX_FOUNDING_TOKEN as string
  const a = sha256Hex(candidate)
  const b = sha256Hex(envToken)
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * SHA-256 hash (hex string) of the provided token.
 *
 * Written to `admins.founding_token_hash` at enrollment time so that
 * subsequent boots can detect re-use (a future check would compare a
 * candidate's hash against the stored hash and refuse).
 */
export function hashFoundingToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

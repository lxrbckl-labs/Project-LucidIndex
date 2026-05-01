'use server'

import { foundingTokenMatches } from '../../../lib/founding-token'

/**
 * Server action: verify a founding-token candidate against the environment.
 *
 * The candidate is trimmed before comparison so copy-pasted tokens with
 * leading/trailing whitespace succeed without confusing the user.
 *
 * Returns `{ ok: true }` when the token matches, `{ ok: false }` otherwise.
 * Never echoes the candidate or the env-var value in the response.
 */
export async function verifyFoundingToken(candidate: string): Promise<{ ok: boolean }> {
  return { ok: foundingTokenMatches(candidate.trim()) }
}

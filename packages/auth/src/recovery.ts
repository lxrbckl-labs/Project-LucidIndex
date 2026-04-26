/**
 * Recovery-code generation, hashing, and verification.
 *
 * Ported from Project-Showalter (`src/features/auth/recovery.ts`), with two
 * adaptations:
 *   - argon2id (via `@node-rs/argon2`) replaces bcryptjs. argon2id is the
 *     OWASP-recommended modern KDF and `@node-rs/argon2` is a fast Rust
 *     binding — Showalter pre-dates that switch but it's the right hash.
 *   - LucidIndex admin ids are uuids (strings), not integers.
 *
 * Codes are shown in plaintext exactly ONCE — at founding-admin enrollment,
 * and again after a successful recovery rotation. Hashed at rest. The
 * plaintext alphabet omits look-alikes (O / 0 / I / 1) so a user reading a
 * code aloud or off a screen doesn't fat-finger it.
 */

import { randomBytes } from 'node:crypto'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'

const CODE_LENGTH = 12

// Crockford-ish: A–Z minus O+I, 2–9. 32 symbols → 60 bits of entropy at
// length 12, plenty for an offline-resistant secondary auth factor.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Returns a random 12-character plaintext recovery code. */
export function generatePlaintextCode(): string {
  const buf = randomBytes(CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index is bounded by loop condition
    out += ALPHABET[buf[i]! % ALPHABET.length]
  }
  return out
}

/** argon2id hash, defaults are the @node-rs/argon2 sensible-defaults preset. */
export async function hashCode(plaintext: string): Promise<string> {
  return argonHash(plaintext)
}

/**
 * Constant-time-ish verify. Returns false on any thrown error — a malformed
 * stored hash should never let a caller distinguish "wrong code" from
 * "corrupted hash".
 */
export async function verifyHash(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await argonVerify(hash, plaintext)
  } catch {
    return false
  }
}

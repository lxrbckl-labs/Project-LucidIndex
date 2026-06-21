/**
 * Passcode generation, hashing, and verification.
 *
 * The passcode is a reusable alternate-login secret (the artifact formerly
 * called the "recovery code"): the admin enters it to sign in when they don't
 * have their passkey. It is an API-token-style high-entropy string — copy-
 * pasted, not typed from memory — so brute-forcing it is infeasible.
 *
 * Format: `lipc_` + 32 random bytes encoded base64url (256 bits of entropy).
 * Hashed at rest with argon2id (the OWASP-recommended KDF, via the fast
 * `@node-rs/argon2` Rust binding). Shown in plaintext exactly once — at
 * founding-admin enrollment and after a passcode regeneration.
 */

import { randomBytes } from 'node:crypto'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'

/** Distinguishes a LucidIndex passcode at a glance (mirrors API-token prefixes). */
const PASSCODE_PREFIX = 'lipc_'
/** 32 bytes → 256 bits of entropy → ~43 base64url chars. */
const PASSCODE_BYTES = 32

/** Returns a random `lipc_`-prefixed 256-bit passcode. */
export function generatePlaintextCode(): string {
  return PASSCODE_PREFIX + randomBytes(PASSCODE_BYTES).toString('base64url')
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

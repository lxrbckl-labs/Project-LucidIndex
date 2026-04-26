/**
 * Server-only data helpers for the Settings → Agent Tokens panel.
 *
 * Security invariants enforced here (NOT in route handlers):
 *   - Cleartext tokens are NEVER persisted. Only the argon2id hash is stored.
 *   - `issueToken()` returns the cleartext to the caller exactly once; if the
 *     DB insert fails for any reason, `null` is returned so the caller NEVER
 *     sends entropy to the client that wasn't actually saved.
 *   - Revocation is `revoked_at = now()`. Rows are never deleted.
 *
 * Token format: 32 bytes via `randomBytes(32).toString('base64url')` — 256
 * bits of entropy, URL-safe alphabet. Agents pass these as:
 *   Authorization: Bearer <token>
 *
 * Phase 3 (mcp-store) will validate bearer tokens against `token_hash`.
 */

import { randomBytes } from 'node:crypto'
import { hashCode as argonHash } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { desc, eq, sql } from '@lucidindex/db/query'
import { agentTokens } from '@lucidindex/db/schema'

export const LABEL_MAX = 100

export type AgentTokenRow = {
  id: string
  label: string
  tokenHash: string
  createdAt: Date
  revokedAt: Date | null
}

export type IssueTokenResult =
  | { ok: true; token: string; row: AgentTokenRow }
  | { ok: false; error: string }

/** List all tokens, newest first. Never returns cleartexts. */
export async function listTokens(): Promise<AgentTokenRow[]> {
  const rows = await db
    .select({
      id: agentTokens.id,
      label: agentTokens.label,
      tokenHash: agentTokens.tokenHash,
      createdAt: agentTokens.createdAt,
      revokedAt: agentTokens.revokedAt,
    })
    .from(agentTokens)
    .orderBy(desc(agentTokens.createdAt))
  return rows
}

/** Get one token by id. Returns null if not found. */
export async function getToken(id: string): Promise<AgentTokenRow | null> {
  const rows = await db
    .select({
      id: agentTokens.id,
      label: agentTokens.label,
      tokenHash: agentTokens.tokenHash,
      createdAt: agentTokens.createdAt,
      revokedAt: agentTokens.revokedAt,
    })
    .from(agentTokens)
    .where(eq(agentTokens.id, id))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Issue a new agent token.
 *
 * 1. Generate 32 random bytes → base64url (256 bits of entropy).
 * 2. Hash with argon2id.
 * 3. Insert row with label + hash.
 * 4. Return cleartext + row on success; `{ ok: false }` on any failure.
 *    The cleartext is NEVER sent to the caller unless the row was saved.
 */
export async function issueToken(label: string): Promise<IssueTokenResult> {
  // Step 1: generate cleartext — 32 bytes = 256 bits of entropy.
  const cleartext = randomBytes(32).toString('base64url')

  // Step 2: hash with argon2id (same KDF as recovery codes).
  let tokenHash: string
  try {
    tokenHash = await argonHash(cleartext)
  } catch (err) {
    return { ok: false, error: `Hashing failed: ${String(err)}` }
  }

  // Step 3: insert. If this throws, the cleartext is discarded below.
  let row: AgentTokenRow
  try {
    const inserted = await db.insert(agentTokens).values({ label, tokenHash }).returning({
      id: agentTokens.id,
      label: agentTokens.label,
      tokenHash: agentTokens.tokenHash,
      createdAt: agentTokens.createdAt,
      revokedAt: agentTokens.revokedAt,
    })
    const r = inserted[0]
    if (!r) {
      // INSERT … RETURNING on a single-row insert always yields one row;
      // if it doesn't, something is very wrong — don't leak the cleartext.
      return { ok: false, error: 'Insert did not return a row.' }
    }
    row = r
  } catch (err) {
    // DB error — cleartext is NOT returned. Entropy that didn't persist
    // must not be sent to the client.
    return { ok: false, error: `DB insert failed: ${String(err)}` }
  }

  // Step 4: success — cleartext returned exactly once.
  return { ok: true, token: cleartext, row }
}

/**
 * Revoke a token by setting `revoked_at = now()`.
 * No-ops if already revoked (idempotent). Returns false if the token
 * doesn't exist.
 */
export async function revokeToken(id: string): Promise<boolean> {
  const existing = await getToken(id)
  if (!existing) return false

  await db.update(agentTokens).set({ revokedAt: sql`now()` }).where(eq(agentTokens.id, id))

  return true
}

/** Validate an issue-token request body. Returns an error string or null. */
export function validateIssueInput(raw: Record<string, unknown>): string | null {
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (!label) return 'Label is required.'
  if (label.length > LABEL_MAX) return `Label must be ${LABEL_MAX} characters or fewer.`
  return null
}

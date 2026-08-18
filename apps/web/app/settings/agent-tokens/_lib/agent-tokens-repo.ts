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
 * Phase 3 (mcp-dashboard) will validate bearer tokens against `token_hash`.
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
 * Postgres LISTEN/NOTIFY channel name the mcp-dashboard sidecar
 * subscribes to. When a token is revoked here, we send a NOTIFY on
 * this channel with the revoked row's UUID as the payload; the
 * sidecar's listener evicts the matching entry from its in-process
 * argon2-verify cache, which means revoke takes effect within the
 * NOTIFY round-trip (~10ms) instead of waiting up to
 * TOKEN_CACHE_TTL_MS (60s) for the cache entry to expire.
 *
 * Channel name is duplicated in `apps/mcp-dashboard/src/auth.ts` —
 * both sides must agree; keep them in sync if you rename.
 */
const TOKEN_REVOKED_CHANNEL = 'agent_token_revoked'

/**
 * Revoke a token by setting `revoked_at = now()`.
 * No-ops if already revoked (idempotent). Returns false if the token
 * doesn't exist.
 *
 * Audit round 9: fires a Postgres NOTIFY on `agent_token_revoked` with
 * the revoked token's id as the payload, so the mcp-dashboard's
 * in-process verify cache evicts the entry immediately instead of
 * waiting for the 60s TTL. The NOTIFY is sent only on a transition
 * (existing.revokedAt was null). Re-revoking an already-revoked token
 * is still a no-op and does not re-fire the NOTIFY — the cache has
 * already evicted on the first revoke and a duplicate signal would be
 * noise.
 *
 * The NOTIFY is fire-and-forget: if Postgres rejects the channel
 * write (extremely unusual — NOTIFY is in-DB), we log a warning and
 * still return true. The TTL is the safety net.
 */
export async function revokeToken(id: string): Promise<boolean> {
  const existing = await getToken(id)
  if (!existing) return false

  await db.update(agentTokens).set({ revokedAt: sql`now()` }).where(eq(agentTokens.id, id))

  // Only signal on a transition (was-active → revoked). Re-revoking
  // an already-revoked token doesn't need a NOTIFY — the cache
  // entry is already gone, and the eviction is idempotent in any
  // case.
  if (existing.revokedAt === null) {
    try {
      // pg_notify is the function form of NOTIFY — works inside a
      // generic SQL execution path (db.execute) without the channel
      // name needing to be a SQL identifier literal. Payload is the
      // token id so the listener can scope the eviction. Channel
      // name is constant; payload is bound parameter.
      await db.execute(sql`SELECT pg_notify(${TOKEN_REVOKED_CHANNEL}, ${id})`)
    } catch {
      // Best-effort. The 60s cache TTL is the fallback — we don't
      // want a NOTIFY hiccup to surface a 500 to the admin who just
      // revoked a token.
    }
  }

  return true
}

/** Validate an issue-token request body. Returns an error string or null. */
export function validateIssueInput(raw: Record<string, unknown>): string | null {
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (!label) return 'Label is required.'
  if (label.length > LABEL_MAX) return `Label must be ${LABEL_MAX} characters or fewer.`
  return null
}

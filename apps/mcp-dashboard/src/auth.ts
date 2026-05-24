// Bearer-token authentication for the Streamable HTTP transport.
//
// HTTP requests must carry `Authorization: Bearer <token>`. We argon2id-verify
// the cleartext against every non-revoked row in `agent_tokens` until one
// matches (typical fleet size is small — single digits). On match, we attach
// the agent_token's id and label to an `AuthContext` that the SDK plumbs
// through to tool handlers via `RequestHandlerExtra.authInfo.extra`.
//
// stdio transport bypasses this entirely (process-local trust per [[MCP]]).
//
// HARD RULE: never log token cleartext. We only log the `agent_token_id`
// (the database row's uuid) and the textual `kind` of failure.
//
// Audit round 6 — in-process verify cache:
// ----------------------------------------
// The argon2id verify pass is intentionally CPU-expensive (~50ms each
// at default tuning). With N agent_tokens rows and R requests per second,
// the worst case is N×R verifies/sec — a trivial DoS vector once the
// fleet grows past a handful of tokens. We add a small in-process
// `Map<sha256(token), { agentTokenId, agentTokenLabel, expiresAt }>`.
// On cache hit (and not expired) we return the cached context without
// running argon2 at all. On miss we run the full verify pass and cache
// the success. TTL is short (60s) so an admin revoking a token still
// catches up within the window — and the existing per-verify
// `revokedAt` check inside the row scan stays in place for the
// non-cached path.
//
// Cache keys are SHA-256 of the bearer cleartext so we never hold the
// raw token in memory. The hash is one-way; if memory leaks to a log
// or core dump, the original token is not recoverable.

import { createHash } from 'node:crypto'
import { db } from '@lucidindex/db/client'
import { agentTokens } from '@lucidindex/db/schema'
import { verify as argonVerify } from '@node-rs/argon2'
import { isNull } from 'drizzle-orm'
import { logger } from './logger.js'

/**
 * Auth context attached to every authenticated MCP request. Tool handlers
 * read this off `RequestHandlerExtra.authInfo.extra` (set by the Streamable
 * HTTP transport's pre-handler middleware below).
 */
export type AuthContext = {
  agentTokenId: string
  /** The agent_token row's `label` — doubles as byline ("Analysis by `<label>`"). */
  agentTokenLabel: string
}

export type AuthFailureReason =
  | 'missing_authorization_header'
  | 'wrong_scheme'
  | 'no_matching_token'
  | 'token_revoked'

export type AuthResult =
  | { ok: true; context: AuthContext }
  | { ok: false; reason: AuthFailureReason }

/** Verify-cache TTL in milliseconds. 60s — long enough to shed argon2 load
 *  under bursts, short enough that a revoked token re-checks within a minute.
 *  Exported for tests that want to force an expiry. */
export const TOKEN_CACHE_TTL_MS = 60_000

type CachedEntry = {
  agentTokenId: string
  agentTokenLabel: string
  expiresAt: number // epoch ms
}

const tokenCache = new Map<string, CachedEntry>()

function tokenCacheKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Drop expired cache entries opportunistically. Called on every miss so
 *  the Map doesn't grow unbounded when tokens churn. O(n) but n is small. */
function evictExpired(now: number): void {
  for (const [k, v] of tokenCache) {
    if (v.expiresAt <= now) tokenCache.delete(k)
  }
}

/**
 * Manually invalidate the cache — used by tests and the
 * LISTEN/NOTIFY listener that fires on `agent_token_revoked` (see
 * `startTokenRevocationListener` below). The TTL is the safety net
 * (revoke takes effect within 60s even if the NOTIFY is lost).
 */
export function clearTokenCache(): void {
  tokenCache.clear()
}

/**
 * Evict every cache entry whose `agentTokenId` matches the given id.
 * Used by the LISTEN/NOTIFY listener so a single revoke doesn't have
 * to drop the entire cache (which would force every active token to
 * pay the argon2 verify cost again on the next request).
 *
 * The cache is keyed by sha256(token-cleartext) and the agent_token
 * id lives in the value — so eviction is O(n), but n is bounded by
 * MAX_CACHE_ENTRIES and the common case is one matching entry per
 * id. Returns the number of evicted entries (useful for tests).
 */
export function evictTokenCacheById(agentTokenId: string): number {
  let removed = 0
  for (const [k, v] of tokenCache) {
    if (v.agentTokenId === agentTokenId) {
      tokenCache.delete(k)
      removed++
    }
  }
  return removed
}

/**
 * Maximum number of entries the verify cache will hold. Once exceeded
 * the oldest entry (Map insertion order, oldest-first) is evicted
 * before inserting the new one. 1000 entries × ~150 bytes ≈ 150 KiB
 * worst case — cheap. The cap exists so a high-churn token rotation
 * cycle (or a hostile client probing many bearer cleartexts that
 * happen to argon2-match revoked rows… which can't happen, but
 * defense-in-depth) cannot grow the Map unboundedly.
 *
 * Audit round 9 — added with the LISTEN/NOTIFY revoke path so the
 * cache has both a hard size ceiling and a sub-second revoke signal.
 */
export const MAX_CACHE_ENTRIES = 1000

/**
 * Parse and validate an `Authorization: Bearer <token>` header against the
 * `agent_tokens` table. Returns the matched row's id + label on success.
 *
 * Note: the row scan is acceptable for the expected fleet size (≤ tens). If
 * the table grows, switch to a deterministic key derivation for lookup or
 * cache the loaded rows in-process. argon2id verification is the
 * security-load-bearing step; the row count just affects how many verifies
 * we run per request.
 */
export async function authenticateBearer(authHeader: string | undefined): Promise<AuthResult> {
  if (!authHeader) {
    return { ok: false, reason: 'missing_authorization_header' }
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return { ok: false, reason: 'wrong_scheme' }
  }
  // biome-ignore lint/style/noNonNullAssertion: regex guarantees group 1
  const token = match[1]!.trim()
  if (!token) {
    return { ok: false, reason: 'wrong_scheme' }
  }

  // ---- cache fast-path ----
  const cacheKey = tokenCacheKey(token)
  const now = Date.now()
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return {
      ok: true,
      context: {
        agentTokenId: cached.agentTokenId,
        agentTokenLabel: cached.agentTokenLabel,
      },
    }
  }
  // Miss or expired — opportunistically evict any other stale entries
  // before doing the heavy verify pass.
  evictExpired(now)

  // Pull only non-revoked rows. Revoked rows are kept (NO DELETIONS) but
  // they're not eligible to authenticate — return `token_revoked` only when
  // a revoked row's hash actually matches, so the operator can distinguish
  // "token unknown" from "token revoked" in audit logs.
  const candidates = await db
    .select({
      id: agentTokens.id,
      label: agentTokens.label,
      tokenHash: agentTokens.tokenHash,
      revokedAt: agentTokens.revokedAt,
    })
    .from(agentTokens)

  for (const row of candidates) {
    let matched = false
    try {
      matched = await argonVerify(row.tokenHash, token)
    } catch {
      // Corrupted hash is treated as a non-match — skip and move on.
      matched = false
    }
    if (!matched) continue
    if (row.revokedAt !== null) {
      return { ok: false, reason: 'token_revoked' }
    }
    // Cache the successful verify so subsequent requests under the same
    // bearer skip argon2 entirely for the next TOKEN_CACHE_TTL_MS.
    // Enforce the MAX_CACHE_ENTRIES ceiling first — Map iteration is
    // insertion-order in V8/JSC, so `keys().next().value` is the
    // oldest entry; drop it before inserting the new one to keep the
    // size bounded (audit round 9).
    if (tokenCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = tokenCache.keys().next().value
      if (oldest !== undefined) tokenCache.delete(oldest)
    }
    tokenCache.set(cacheKey, {
      agentTokenId: row.id,
      agentTokenLabel: row.label,
      expiresAt: now + TOKEN_CACHE_TTL_MS,
    })
    return {
      ok: true,
      context: { agentTokenId: row.id, agentTokenLabel: row.label },
    }
  }

  return { ok: false, reason: 'no_matching_token' }
}

/**
 * Convenience helper for the few places that want to count active tokens
 * without doing a verify pass — currently unused but kept here so future
 * health checks have an obvious home.
 */
export async function countActiveAgentTokens(): Promise<number> {
  const rows = await db
    .select({ id: agentTokens.id })
    .from(agentTokens)
    .where(isNull(agentTokens.revokedAt))
  return rows.length
}

/** Logs a successful auth event. Never receives the cleartext token. */
export function logAuthSucceeded(agentTokenId: string) {
  logger.info('mcp_auth_succeeded', { agent_token_id: agentTokenId })
}

/** Logs a failed auth event with the textual reason (no cleartext). */
export function logAuthFailed(reason: AuthFailureReason) {
  logger.warn('mcp_auth_failed', { reason })
}

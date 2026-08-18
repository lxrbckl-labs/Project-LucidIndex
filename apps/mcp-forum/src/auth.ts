// Bearer-token authentication for the mcp-forum Streamable HTTP
// transport.
//
// HTTP requests must carry `Authorization: Bearer <token>`. We
// argon2id-verify the cleartext against every non-revoked row in
// `forum_agent_tokens` until one matches (typical fleet is small —
// single digits). On match, we attach the agent's forum identity
// (forum_users.id) and the token's label/id to an `AuthContext` that
// the SDK plumbs through to tool handlers via
// `RequestHandlerExtra.authInfo.extra`.
//
// HARD RULE: never log token cleartext. We only log
// `forum_agent_token_id` (the database row's uuid) and the textual
// `kind` of failure.
//
// Why a separate table from agent_tokens (the content-pipeline fleet)?
// Different threat models and lifecycles — see schema/forum.ts for the
// full rationale. The auth shape here intentionally mirrors
// apps/mcp-dashboard/src/auth.ts so future operators can grok both sidecars
// the same way; only the table name and the carried context differ.
//
// Audit round 6+9 (ported from mcp-dashboard) — in-process verify cache:
// ---------------------------------------------------------------------
// The argon2id verify pass is intentionally CPU-expensive (~50ms each
// at default tuning). With N forum_agent_tokens rows and R requests
// per second, the worst case is N×R verifies/sec — a trivial DoS
// vector once the fleet grows past a handful of tokens. We add a small
// in-process `Map<sha256(token), { ...ctx, expiresAt }>`. On cache hit
// (and not expired) we return the cached context without running
// argon2 at all. On miss we run the full verify pass and cache the
// success. TTL is short (60s) so an admin revoking a token still
// catches up within the window — and the existing per-verify
// `revokedAt` check inside the row scan stays in place for the
// non-cached path.
//
// Cache keys are SHA-256 of the bearer cleartext so we never hold the
// raw token in memory. The hash is one-way; if memory leaks to a log
// or core dump, the original token is not recoverable.
//
// `evictTokenCacheById(forumAgentTokenId)` lets the LISTEN/NOTIFY
// revoke listener drop only the matching entry on a `pg_notify`
// signal, so revoke takes effect within the round-trip instead of
// waiting up to 60s for the cache TTL.

import { createHash } from 'node:crypto'
import { db } from '@lucidindex/db/client'
import { forumAgentTokens, forumUsers } from '@lucidindex/db/schema'
import { verify as argonVerify } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { logger } from './logger.js'

/**
 * Auth context attached to every authenticated MCP request. Tool
 * handlers read this off `RequestHandlerExtra.authInfo.extra`.
 *
 * Carries the forum identity (`forumUserId`) so tool handlers can
 * scope writes to the agent's own forum_users row without needing a
 * second lookup. `tokenLabel` doubles as a debug-friendly identifier
 * in logs and (eventually) on admin-facing surfaces.
 */
export type AuthContext = {
  forumAgentTokenId: string
  forumUserId: string
  tokenLabel: string
  username: string
  isAgent: boolean
}

export type AuthFailureReason =
  | 'missing_authorization_header'
  | 'wrong_scheme'
  | 'no_matching_token'
  | 'token_revoked'
  | 'user_not_agent'

export type AuthResult =
  | { ok: true; context: AuthContext }
  | { ok: false; reason: AuthFailureReason }

/** Verify-cache TTL in milliseconds. 60s — long enough to shed argon2 load
 *  under bursts, short enough that a revoked token re-checks within a minute.
 *  Exported for tests that want to force an expiry. */
export const TOKEN_CACHE_TTL_MS = 60_000

type CachedEntry = {
  context: AuthContext
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
 * LISTEN/NOTIFY listener that fires on `forum_agent_token_revoked`
 * (see `token-revocation-listener.ts`). The TTL is the safety net
 * (revoke takes effect within 60s even if the NOTIFY is lost).
 */
export function clearTokenCache(): void {
  tokenCache.clear()
}

/**
 * Evict every cache entry whose `forumAgentTokenId` matches the given
 * id. Used by the LISTEN/NOTIFY listener so a single revoke doesn't
 * have to drop the entire cache (which would force every active token
 * to pay the argon2 verify cost again on the next request).
 *
 * The cache is keyed by sha256(token-cleartext) and the
 * forum_agent_token id lives in the value — so eviction is O(n), but
 * n is bounded by MAX_CACHE_ENTRIES and the common case is one
 * matching entry per id. Returns the number of evicted entries
 * (useful for tests).
 */
export function evictTokenCacheById(forumAgentTokenId: string): number {
  let removed = 0
  for (const [k, v] of tokenCache) {
    if (v.context.forumAgentTokenId === forumAgentTokenId) {
      tokenCache.delete(k)
      removed++
    }
  }
  return removed
}

/**
 * Maximum number of entries the verify cache will hold. Once exceeded
 * the oldest entry (Map insertion order, oldest-first) is evicted
 * before inserting the new one. 1000 entries × ~200 bytes ≈ 200 KiB
 * worst case — cheap. The cap exists so a high-churn token rotation
 * cycle (or a hostile client probing many bearer cleartexts that
 * happen to argon2-match revoked rows… which can't happen, but
 * defense-in-depth) cannot grow the Map unboundedly.
 */
export const MAX_CACHE_ENTRIES = 1000

/**
 * Parse and validate an `Authorization: Bearer <token>` header against
 * the `forum_agent_tokens` table. Returns the matched row's id +
 * forum_user info on success.
 *
 * Row-scan is acceptable at fleet size ≤ tens. argon2id verification
 * is the security-load-bearing step; row count only affects how many
 * verifies we run per request.
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
    return { ok: true, context: cached.context }
  }
  // Miss or expired — opportunistically evict any other stale entries
  // before doing the heavy verify pass.
  evictExpired(now)

  // Join forum_agent_tokens → forum_users so a successful auth resolves
  // username + isAgent + forumUserId in one pass. Revoked rows are
  // kept (NO DELETIONS) and we still surface `token_revoked` when one
  // matches so the admin can distinguish "unknown" from "revoked" in
  // audit logs.
  const candidates = await db
    .select({
      tokenId: forumAgentTokens.id,
      tokenHash: forumAgentTokens.tokenHash,
      tokenLabel: forumAgentTokens.label,
      revokedAt: forumAgentTokens.revokedAt,
      forumUserId: forumUsers.id,
      username: forumUsers.username,
      isAgent: forumUsers.isAgent,
    })
    .from(forumAgentTokens)
    .innerJoin(forumUsers, eq(forumUsers.id, forumAgentTokens.userId))

  for (const row of candidates) {
    let matched = false
    try {
      matched = await argonVerify(row.tokenHash, token)
    } catch {
      matched = false
    }
    if (!matched) continue
    if (row.revokedAt !== null) {
      return { ok: false, reason: 'token_revoked' }
    }
    // Belt-and-suspenders: even though the mint flow only issues tokens
    // for is_agent=true rows, refuse to authenticate if the linked
    // forum user has been flipped to a human after the fact. The forum
    // MCP is agent-only by design.
    if (!row.isAgent) {
      return { ok: false, reason: 'user_not_agent' }
    }
    const context: AuthContext = {
      forumAgentTokenId: row.tokenId,
      forumUserId: row.forumUserId,
      tokenLabel: row.tokenLabel,
      username: row.username,
      isAgent: row.isAgent,
    }
    // Cache the successful verify so subsequent requests under the
    // same bearer skip argon2 entirely for the next
    // TOKEN_CACHE_TTL_MS. Enforce the MAX_CACHE_ENTRIES ceiling
    // first — Map iteration is insertion-order in V8/JSC, so
    // `keys().next().value` is the oldest entry; drop it before
    // inserting the new one to keep the size bounded.
    if (tokenCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = tokenCache.keys().next().value
      if (oldest !== undefined) tokenCache.delete(oldest)
    }
    tokenCache.set(cacheKey, {
      context,
      expiresAt: now + TOKEN_CACHE_TTL_MS,
    })
    return { ok: true, context }
  }

  return { ok: false, reason: 'no_matching_token' }
}

/** Logs a successful auth event. Never receives the cleartext token. */
export function logAuthSucceeded(forumAgentTokenId: string, forumUserId: string) {
  logger.info('mcp_forum_auth_succeeded', {
    forum_agent_token_id: forumAgentTokenId,
    forum_user_id: forumUserId,
  })
}

/** Logs a failed auth event with the textual reason (no cleartext). */
export function logAuthFailed(reason: AuthFailureReason) {
  logger.warn('mcp_forum_auth_failed', { reason })
}

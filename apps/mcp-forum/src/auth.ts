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
// apps/mcp-store/src/auth.ts so future operators can grok both sidecars
// the same way; only the table name and the carried context differ.

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
    return {
      ok: true,
      context: {
        forumAgentTokenId: row.tokenId,
        forumUserId: row.forumUserId,
        tokenLabel: row.tokenLabel,
        username: row.username,
        isAgent: row.isAgent,
      },
    }
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

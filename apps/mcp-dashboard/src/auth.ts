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

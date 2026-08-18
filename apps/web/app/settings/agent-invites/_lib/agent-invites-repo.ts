/**
 * Server-only data helpers for the Settings → Agent Invites panel
 * (forum side) and the public `/api/agent-invites/forum/redeem`
 * endpoint.
 *
 * Parallel to `dashboard-agent-invites-repo`, with one forum-specific
 * twist: every agent on the forum needs a `forum_users` identity, and
 * that identity needs a unique handle. The admin pre-bakes the
 * username into the invite at mint time, and redemption uses it
 * verbatim to create the `forum_users` row alongside the new
 * `forum_agent_tokens` row.
 *
 * Username uniqueness is enforced at three layers, defense-in-depth:
 *   1. Issue path: `validateUsername` does a pre-check against
 *      `forum_users.username` (UX nicety — admin sees "username taken"
 *      before they commit).
 *   2. Forum-invite CHECK: `forum_agent_invites_agent_username_check`
 *      enforces the regex shape (no enforcement against existing users
 *      here — same handle could appear on two invites, only one will
 *      win at redemption).
 *   3. Redemption transaction: `forum_users.username` UNIQUE constraint
 *      is the FINAL guard. If a race grabs the username between issue
 *      and redeem, the INSERT throws → return `username_taken`.
 *
 * Cleartext codes and bearer tokens exit this module exactly once.
 */

import { randomBytes } from 'node:crypto'
import { hashCode as argonHash, verifyHash as argonVerify } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { and, desc, eq, gt, isNull, or, sql } from '@lucidindex/db/query'
import { forumAgentInvites, forumAgentTokens, forumUsers } from '@lucidindex/db/schema'

export const LABEL_MAX = 100
export const USERNAME_MIN = 3
export const USERNAME_MAX = 20
export const USERNAME_REGEX = /^[a-z][a-z0-9_-]{2,19}$/

export type ForumAgentInviteRow = {
  id: string
  label: string
  agentUsername: string
  codeHash: string
  createdAt: Date
  expiresAt: Date | null
  redeemedAt: Date | null
  redeemedTokenId: string | null
  revokedAt: Date | null
  /**
   * Mirror of `forum_agent_tokens.revoked_at` for the redeemed token,
   * populated only when `redeemedTokenId` is non-null. The invite-side
   * revoke (this row's `revokedAt`) and the token-side revoke
   * (`tokenRevokedAt`) are independent kill-switches: revoking the
   * invite is an audit marker, revoking the TOKEN is the actual
   * MCP-access kill-switch. The UI surfaces both.
   */
  tokenRevokedAt: Date | null
}

export type IssueInviteInput = {
  label: string
  username: string
  adminId: string | null
}

export type IssueInviteResult =
  | { ok: true; code: string; row: ForumAgentInviteRow }
  | { ok: false; error: string }

export type InviteStatus = 'available' | 'redeemed' | 'expired' | 'revoked'

/**
 * Compute the user-facing status of an invite row. Revocation wins
 * over redemption — a revoked-after-redemption row reports 'revoked'
 * so the admin sees the kill-switch state.
 */
export function deriveInviteStatus(row: ForumAgentInviteRow, now: Date = new Date()): InviteStatus {
  if (row.revokedAt) return 'revoked'
  if (row.redeemedAt) return 'redeemed'
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'available'
}

/**
 * Validate a candidate agent username. Returns an error message
 * string or null if valid. Performs three checks:
 *   1. Shape: matches `^[a-z][a-z0-9_-]{2,19}$`.
 *   2. Uniqueness vs existing `forum_users.username` (TOCTOU — the
 *      final guard is the UNIQUE constraint at redeem time).
 *
 * The async signature is intentional — DB lookup is needed for the
 * uniqueness check. Callers should `await validateUsername(...)`.
 */
export async function validateUsername(raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string') return 'Username is required.'
  const username = raw.trim()
  if (!username) return 'Username is required.'
  if (username.length < USERNAME_MIN) {
    return `Username must be at least ${USERNAME_MIN} characters.`
  }
  if (username.length > USERNAME_MAX) {
    return `Username must be ${USERNAME_MAX} characters or fewer.`
  }
  if (!USERNAME_REGEX.test(username)) {
    return 'Username must start with a letter and contain only lowercase letters, digits, hyphens, or underscores.'
  }

  const taken = await db
    .select({ id: forumUsers.id })
    .from(forumUsers)
    .where(eq(forumUsers.username, username))
    .limit(1)
  if (taken[0]) return 'Username already in use.'

  return null
}

/** List every forum-agent invite, newest first. Never returns cleartexts. */
export async function listInvites(): Promise<ForumAgentInviteRow[]> {
  // Left join on forum_agent_tokens via redeemed_token_id so the UI
  // can show both kill-switches (invite-side revoke + token-side
  // revoke) on the same row. Unredeemed invites carry
  // `tokenRevokedAt: null` because they have no token yet.
  const rows = await db
    .select({
      id: forumAgentInvites.id,
      label: forumAgentInvites.label,
      agentUsername: forumAgentInvites.agentUsername,
      codeHash: forumAgentInvites.codeHash,
      createdAt: forumAgentInvites.createdAt,
      expiresAt: forumAgentInvites.expiresAt,
      redeemedAt: forumAgentInvites.redeemedAt,
      redeemedTokenId: forumAgentInvites.redeemedTokenId,
      revokedAt: forumAgentInvites.revokedAt,
      tokenRevokedAt: forumAgentTokens.revokedAt,
    })
    .from(forumAgentInvites)
    .leftJoin(forumAgentTokens, eq(forumAgentInvites.redeemedTokenId, forumAgentTokens.id))
    .orderBy(desc(forumAgentInvites.createdAt))
  return rows
}

export type RevokeInviteResult =
  | { ok: true; alreadyRevoked: boolean }
  | { ok: false; reason: 'not_found' }

/**
 * Revoke an invite — idempotent. Works on redeemed AND unredeemed
 * rows; for redeemed rows the corresponding `forum_agent_tokens` row
 * is the actual access kill-switch (admins revoke the token there).
 */
export async function revokeInvite(id: string): Promise<RevokeInviteResult> {
  const rows = await db
    .select({
      id: forumAgentInvites.id,
      revokedAt: forumAgentInvites.revokedAt,
    })
    .from(forumAgentInvites)
    .where(eq(forumAgentInvites.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.revokedAt) return { ok: true, alreadyRevoked: true }

  await db
    .update(forumAgentInvites)
    .set({ revokedAt: sql`now()` })
    .where(eq(forumAgentInvites.id, id))
  return { ok: true, alreadyRevoked: false }
}

export type UnrevokeInviteResult =
  | { ok: true; alreadyActive: boolean }
  | { ok: false; reason: 'not_found' }

/** Restore a revoked invite — clears `revoked_at` back to NULL. Idempotent. */
export async function unrevokeInvite(id: string): Promise<UnrevokeInviteResult> {
  const rows = await db
    .select({
      id: forumAgentInvites.id,
      revokedAt: forumAgentInvites.revokedAt,
    })
    .from(forumAgentInvites)
    .where(eq(forumAgentInvites.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (!row.revokedAt) return { ok: true, alreadyActive: true }

  await db.update(forumAgentInvites).set({ revokedAt: null }).where(eq(forumAgentInvites.id, id))
  return { ok: true, alreadyActive: false }
}

export type DeleteInviteResult = { ok: true } | { ok: false; reason: 'not_found' | 'still_active' }

/**
 * Hard-delete an invite row. Refuses if still "available". Deleting
 * a redeemed invite does NOT cascade-destroy the `forum_users` row
 * or `forum_agent_tokens` row — `redeemed_token_id`'s FK is ON DELETE
 * SET NULL. The agent identity and its token survive.
 */
export async function deleteInvite(id: string): Promise<DeleteInviteResult> {
  const rows = await db
    .select({
      id: forumAgentInvites.id,
      redeemedAt: forumAgentInvites.redeemedAt,
      revokedAt: forumAgentInvites.revokedAt,
      expiresAt: forumAgentInvites.expiresAt,
    })
    .from(forumAgentInvites)
    .where(eq(forumAgentInvites.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }

  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()
  const inactive = row.redeemedAt !== null || row.revokedAt !== null || expired
  if (!inactive) return { ok: false, reason: 'still_active' }

  await db.delete(forumAgentInvites).where(eq(forumAgentInvites.id, id))
  return { ok: true }
}

export type CleanInvitesResult = { ok: true; deleted: number }

/** Bulk-delete every invite that isn't currently available. */
export async function cleanInactiveInvites(): Promise<CleanInvitesResult> {
  const result = await db
    .delete(forumAgentInvites)
    .where(
      sql`(${forumAgentInvites.redeemedAt} IS NOT NULL
        OR ${forumAgentInvites.revokedAt} IS NOT NULL
        OR (${forumAgentInvites.expiresAt} IS NOT NULL AND ${forumAgentInvites.expiresAt} <= now()))`,
    )
    .returning({ id: forumAgentInvites.id })
  return { ok: true, deleted: result.length }
}

/**
 * Generate a fresh invite, hash it, persist with the pre-baked
 * username, return cleartext + row. The caller is expected to have
 * already run `validateUsername` (the route handler does this).
 *
 * If the INSERT fails (e.g. an exotic DB error) we return `ok: false`
 * so the caller never hands the client entropy that wasn't saved.
 */
export async function issueInvite(input: IssueInviteInput): Promise<IssueInviteResult> {
  const label = input.label.trim()
  const username = input.username.trim()
  if (!label) return { ok: false, error: 'Label is required.' }
  if (label.length > LABEL_MAX) {
    return { ok: false, error: `Label must be ${LABEL_MAX} characters or fewer.` }
  }
  if (!USERNAME_REGEX.test(username)) {
    return {
      ok: false,
      error:
        'Username must start with a letter and contain only lowercase letters, digits, hyphens, or underscores.',
    }
  }

  // 24 bytes → 32-char base64url. Matches forum_invites and
  // dashboard_agent_invites — same threat profile.
  const code = randomBytes(24).toString('base64url')
  const codeHash = await argonHash(code)

  try {
    const inserted = await db
      .insert(forumAgentInvites)
      .values({
        label,
        agentUsername: username,
        codeHash,
        createdByAdminId: input.adminId,
      })
      .returning({
        id: forumAgentInvites.id,
        label: forumAgentInvites.label,
        agentUsername: forumAgentInvites.agentUsername,
        codeHash: forumAgentInvites.codeHash,
        createdAt: forumAgentInvites.createdAt,
        expiresAt: forumAgentInvites.expiresAt,
        redeemedAt: forumAgentInvites.redeemedAt,
        redeemedTokenId: forumAgentInvites.redeemedTokenId,
        revokedAt: forumAgentInvites.revokedAt,
      })
    const row = inserted[0]
    if (!row) return { ok: false, error: 'Insert returned no row.' }
    // A fresh invite has no redeemed token yet, so `tokenRevokedAt`
    // is always null on this code path. Shape-match the read surface.
    return { ok: true, code, row: { ...row, tokenRevokedAt: null } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error issuing invite.'
    return { ok: false, error: message }
  }
}

export type CheckInviteResult = { ok: true; inviteId: string } | { ok: false; reason: 'invalid' }

/**
 * Verify an invite code against unredeemed, unrevoked, unexpired
 * rows. Pre-flight check used by callers that want a non-
 * transactional answer. The redemption transaction does its own
 * lookup inside the lock so this isn't TOCTOU-relied-on.
 *
 * Single `invalid` reason — don't leak whether a code was ever
 * issued, expired, or already redeemed.
 */
export async function checkInviteCode(code: string): Promise<CheckInviteResult> {
  const trimmed = code.trim()
  if (!trimmed) return { ok: false, reason: 'invalid' }

  const candidates = await db
    .select({ id: forumAgentInvites.id, codeHash: forumAgentInvites.codeHash })
    .from(forumAgentInvites)
    .where(
      and(
        isNull(forumAgentInvites.redeemedAt),
        isNull(forumAgentInvites.revokedAt),
        or(isNull(forumAgentInvites.expiresAt), gt(forumAgentInvites.expiresAt, new Date())),
      ),
    )

  for (const c of candidates) {
    if (await argonVerify(trimmed, c.codeHash)) {
      return { ok: true, inviteId: c.id }
    }
  }
  return { ok: false, reason: 'invalid' }
}

/**
 * Postgres LISTEN/NOTIFY channel name the mcp-forum sidecar subscribes
 * to. When a forum_agent_token is revoked here (or wherever a future
 * revoke surface lives), we send a NOTIFY on this channel with the
 * revoked row's UUID as the payload; the sidecar's listener evicts
 * the matching entry from its in-process argon2-verify cache, which
 * means revoke takes effect within the NOTIFY round-trip (~10ms)
 * instead of waiting up to TOKEN_CACHE_TTL_MS (60s) for the cache
 * entry to expire.
 *
 * Channel name is duplicated in
 * `apps/mcp-forum/src/token-revocation-listener.ts` — both sides must
 * agree; keep them in sync if you rename.
 */
const FORUM_TOKEN_REVOKED_CHANNEL = 'forum_agent_token_revoked'

export type RevokeForumAgentTokenResult =
  | { ok: true; alreadyRevoked: boolean }
  | { ok: false; reason: 'not_found' }

/**
 * Revoke a `forum_agent_tokens` row — idempotent. Sets `revoked_at =
 * now()` and fires a `pg_notify('forum_agent_token_revoked', <id>)`
 * on the transition so the mcp-forum sidecar evicts the in-process
 * cache entry immediately instead of waiting the 60s TTL.
 *
 * Re-revoking an already-revoked token is a no-op and does NOT
 * re-fire the NOTIFY — the cache has already evicted on the first
 * revoke and a duplicate signal would be noise.
 *
 * The NOTIFY is fire-and-forget: if Postgres rejects the channel
 * write (extremely unusual — NOTIFY is in-DB), we swallow the error
 * and return `{ ok: true }`. The TTL is the safety net.
 *
 * Currently no UI surface invokes this — kept here so the
 * cache-invalidation channel is wired the moment a forum-token revoke
 * route lands (mirrors the dashboard side at
 * `apps/web/app/settings/agent-tokens/_lib/agent-tokens-repo.ts` →
 * `revokeToken`).
 */
export async function revokeForumAgentToken(id: string): Promise<RevokeForumAgentTokenResult> {
  const rows = await db
    .select({
      id: forumAgentTokens.id,
      revokedAt: forumAgentTokens.revokedAt,
    })
    .from(forumAgentTokens)
    .where(eq(forumAgentTokens.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.revokedAt) return { ok: true, alreadyRevoked: true }

  await db
    .update(forumAgentTokens)
    .set({ revokedAt: sql`now()` })
    .where(eq(forumAgentTokens.id, id))

  // Best-effort cache-eviction signal. The 60s TTL is the fallback —
  // we don't want a NOTIFY hiccup to surface a 500 to the admin who
  // just revoked a token.
  try {
    await db.execute(sql`SELECT pg_notify(${FORUM_TOKEN_REVOKED_CHANNEL}, ${id})`)
  } catch {
    /* best-effort */
  }

  return { ok: true, alreadyRevoked: false }
}

export type RedeemInviteResult =
  | {
      ok: true
      token: string
      tokenId: string
      label: string
      username: string
      forumUserId: string
    }
  | { ok: false; reason: 'invalid_code' | 'username_taken' | 'db_error' }

/**
 * Atomically redeem a forum-agent invite. The redemption transaction
 * is the longest in this module — six steps inside a single DB
 * transaction, any of which can fail and roll back the whole thing.
 *
 * Steps:
 *   1. Verify code (argon2 linear scan) against unredeemed candidates.
 *   2. Lock the matched invite row FOR UPDATE; TOCTOU re-check
 *      redeemed/revoked/expired.
 *   3. INSERT `forum_users` row with `username = invite.agent_username`
 *      and `is_agent = true`. Detect unique-violation → return
 *      `username_taken`.
 *   4. Generate 32 random bytes → base64url cleartext (256 bits) and
 *      argon2id-hash.
 *   5. INSERT `forum_agent_tokens` linking the new user, with the
 *      invite's label and the invite's `created_by_admin_id`.
 *   6. UPDATE invite SET redeemed_at = now(), redeemed_token_id =
 *      <new token id>.
 *
 * Cleartext leaves this module exactly once (in the `ok: true` payload).
 */
export async function redeemInvite(code: string): Promise<RedeemInviteResult> {
  const trimmed = code.trim()
  if (!trimmed) return { ok: false, reason: 'invalid_code' }

  try {
    return await db.transaction(async (tx) => {
      // Step 1: find matching invite by argon2 verify.
      const candidates = await tx
        .select({
          id: forumAgentInvites.id,
          codeHash: forumAgentInvites.codeHash,
        })
        .from(forumAgentInvites)
        .where(
          and(
            isNull(forumAgentInvites.redeemedAt),
            isNull(forumAgentInvites.revokedAt),
            or(isNull(forumAgentInvites.expiresAt), gt(forumAgentInvites.expiresAt, new Date())),
          ),
        )

      let matchedId: string | null = null
      for (const c of candidates) {
        if (await argonVerify(trimmed, c.codeHash)) {
          matchedId = c.id
          break
        }
      }
      if (!matchedId) {
        return { ok: false, reason: 'invalid_code' } as const
      }

      // Step 2: lock the invite row FOR UPDATE; re-check status.
      const lockedRows = await tx.execute<{
        id: string
        label: string
        agent_username: string
        created_by_admin_id: string | null
        redeemed_at: Date | null
        revoked_at: Date | null
        expires_at: Date | null
      }>(
        sql`SELECT id, label, agent_username, created_by_admin_id, redeemed_at, revoked_at, expires_at
            FROM ${forumAgentInvites}
            WHERE id = ${matchedId}
            FOR UPDATE`,
      )
      const locked = (
        lockedRows as unknown as Array<{
          id: string
          label: string
          agent_username: string
          created_by_admin_id: string | null
          redeemed_at: Date | null
          revoked_at: Date | null
          expires_at: Date | null
        }>
      )[0]
      if (!locked) {
        return { ok: false, reason: 'invalid_code' } as const
      }

      const now = new Date()
      if (locked.redeemed_at !== null) {
        return { ok: false, reason: 'invalid_code' } as const
      }
      if (locked.revoked_at !== null) {
        return { ok: false, reason: 'invalid_code' } as const
      }
      if (locked.expires_at !== null && new Date(locked.expires_at).getTime() <= now.getTime()) {
        return { ok: false, reason: 'invalid_code' } as const
      }

      // Step 3: create forum_users row. Unique-violation on
      // `username` → username_taken (race grabbed the handle).
      let newForumUserId: string
      try {
        const insertedUsers = await tx
          .insert(forumUsers)
          .values({
            username: locked.agent_username,
            isAgent: true,
          })
          .returning({ id: forumUsers.id })
        const u = insertedUsers[0]
        if (!u) {
          throw new Error('forum_users insert returned no row')
        }
        newForumUserId = u.id
      } catch (err) {
        // Drizzle/postgres-js surfaces unique violations as Postgres
        // error code 23505. We can't always rely on the SQLSTATE
        // being on the error object cleanly, so match on the
        // constraint text as a fallback.
        const code = (err as { code?: string }).code
        const message = err instanceof Error ? err.message : String(err)
        if (code === '23505' || /forum_users.*username.*(unique|duplicate)/i.test(message)) {
          return { ok: false, reason: 'username_taken' } as const
        }
        throw err
      }

      // Step 4: mint cleartext token + hash.
      const cleartext = randomBytes(32).toString('base64url')
      const tokenHash = await argonHash(cleartext)

      // Step 5: insert forum_agent_tokens linking the new user.
      const insertedTokens = await tx
        .insert(forumAgentTokens)
        .values({
          userId: newForumUserId,
          tokenHash,
          label: locked.label,
          createdByAdminId: locked.created_by_admin_id,
        })
        .returning({
          id: forumAgentTokens.id,
          label: forumAgentTokens.label,
        })
      const newToken = insertedTokens[0]
      if (!newToken) {
        throw new Error('forum_agent_tokens insert returned no row')
      }

      // Step 6: stamp the invite as redeemed.
      await tx
        .update(forumAgentInvites)
        .set({
          redeemedAt: sql`now()`,
          redeemedTokenId: newToken.id,
        })
        .where(eq(forumAgentInvites.id, matchedId))

      return {
        ok: true,
        token: cleartext,
        tokenId: newToken.id,
        label: newToken.label,
        username: locked.agent_username,
        forumUserId: newForumUserId,
      } as const
    })
  } catch (_err) {
    return { ok: false, reason: 'db_error' }
  }
}

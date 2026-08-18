/**
 * Server-only data helpers for the Settings → Dashboard → Agent Invites
 * panel and the public `/api/agent-invites/dashboard/redeem` endpoint.
 *
 * Mirror of `forum-invites-repo` (human-side) and `agent-tokens-repo`
 * (direct mint), specialized for the Dashboard MCP fleet. Cleartext
 * codes and bearer tokens exit this module exactly once at their
 * respective creation/redemption sites; only argon2id hashes live in
 * the DB.
 *
 * Redemption is a single atomic DB transaction:
 *   1. Lock the matching invite row FOR UPDATE.
 *   2. Re-check redeemed / revoked / expired status (TOCTOU guard).
 *   3. INSERT new `agent_tokens` row (cleartext returned exactly once).
 *   4. UPDATE invite with `redeemed_at = now()`, `redeemed_token_id`.
 * Any failure rolls the transaction back — no half-written rows, no
 * cleartext leak.
 */

import { randomBytes } from 'node:crypto'
import { hashCode as argonHash, verifyHash as argonVerify } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { and, desc, eq, gt, isNull, or, sql } from '@lucidindex/db/query'
import { agentTokens, dashboardAgentInvites } from '@lucidindex/db/schema'

export const LABEL_MAX = 100

export type DashboardAgentInviteRow = {
  id: string
  label: string
  codeHash: string
  createdAt: Date
  expiresAt: Date | null
  redeemedAt: Date | null
  redeemedTokenId: string | null
  revokedAt: Date | null
}

export type IssueInviteInput = {
  label: string
  adminId: string | null
}

export type IssueInviteResult =
  | { ok: true; code: string; row: DashboardAgentInviteRow }
  | { ok: false; error: string }

export type InviteStatus = 'available' | 'redeemed' | 'expired' | 'revoked'

/**
 * Compute the user-facing status of an invite row. Same posture as
 * `forum-invites-repo.deriveInviteStatus` — revocation wins over
 * redemption (a revoked-after-redemption row should report 'revoked'
 * so the admin knows the agent's token has been killed).
 */
export function deriveInviteStatus(
  row: DashboardAgentInviteRow,
  now: Date = new Date(),
): InviteStatus {
  if (row.revokedAt) return 'revoked'
  if (row.redeemedAt) return 'redeemed'
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'available'
}

/** List every dashboard-agent invite, newest first. Never returns cleartexts. */
export async function listInvites(): Promise<DashboardAgentInviteRow[]> {
  const rows = await db
    .select({
      id: dashboardAgentInvites.id,
      label: dashboardAgentInvites.label,
      codeHash: dashboardAgentInvites.codeHash,
      createdAt: dashboardAgentInvites.createdAt,
      expiresAt: dashboardAgentInvites.expiresAt,
      redeemedAt: dashboardAgentInvites.redeemedAt,
      redeemedTokenId: dashboardAgentInvites.redeemedTokenId,
      revokedAt: dashboardAgentInvites.revokedAt,
    })
    .from(dashboardAgentInvites)
    .orderBy(desc(dashboardAgentInvites.createdAt))
  return rows
}

export type RevokeInviteResult =
  | { ok: true; alreadyRevoked: boolean }
  | { ok: false; reason: 'not_found' }

/**
 * Revoke an invite — idempotent. Calling twice on an already-revoked
 * row is a no-op. Works regardless of redemption state: revoking a
 * redeemed invite acts as audit metadata (the linked agent_tokens row
 * is the actual kill-switch — admins revoke the token there).
 */
export async function revokeInvite(id: string): Promise<RevokeInviteResult> {
  const rows = await db
    .select({
      id: dashboardAgentInvites.id,
      revokedAt: dashboardAgentInvites.revokedAt,
    })
    .from(dashboardAgentInvites)
    .where(eq(dashboardAgentInvites.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.revokedAt) return { ok: true, alreadyRevoked: true }

  await db
    .update(dashboardAgentInvites)
    .set({ revokedAt: sql`now()` })
    .where(eq(dashboardAgentInvites.id, id))
  return { ok: true, alreadyRevoked: false }
}

export type UnrevokeInviteResult =
  | { ok: true; alreadyActive: boolean }
  | { ok: false; reason: 'not_found' }

/**
 * Restore a revoked invite — clears `revoked_at` back to NULL.
 * Idempotent on already-active rows. Preserves `redeemed_at` so a
 * redeem→revoke→unrevoke round-trip returns the row to 'redeemed'.
 */
export async function unrevokeInvite(id: string): Promise<UnrevokeInviteResult> {
  const rows = await db
    .select({
      id: dashboardAgentInvites.id,
      revokedAt: dashboardAgentInvites.revokedAt,
    })
    .from(dashboardAgentInvites)
    .where(eq(dashboardAgentInvites.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (!row.revokedAt) return { ok: true, alreadyActive: true }

  await db
    .update(dashboardAgentInvites)
    .set({ revokedAt: null })
    .where(eq(dashboardAgentInvites.id, id))
  return { ok: true, alreadyActive: false }
}

export type DeleteInviteResult = { ok: true } | { ok: false; reason: 'not_found' | 'still_active' }

/**
 * Hard-delete an invite row. Refuses if the invite is still
 * "available" (could still be redeemed). Admins must revoke first to
 * move the row into a deletable terminal state. The FK on
 * `redeemed_token_id` is ON DELETE SET NULL, so deleting an invite
 * does NOT cascade-destroy its linked token row.
 */
export async function deleteInvite(id: string): Promise<DeleteInviteResult> {
  const rows = await db
    .select({
      id: dashboardAgentInvites.id,
      redeemedAt: dashboardAgentInvites.redeemedAt,
      revokedAt: dashboardAgentInvites.revokedAt,
      expiresAt: dashboardAgentInvites.expiresAt,
    })
    .from(dashboardAgentInvites)
    .where(eq(dashboardAgentInvites.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }

  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()
  const inactive = row.redeemedAt !== null || row.revokedAt !== null || expired
  if (!inactive) return { ok: false, reason: 'still_active' }

  await db.delete(dashboardAgentInvites).where(eq(dashboardAgentInvites.id, id))
  return { ok: true }
}

export type CleanInvitesResult = { ok: true; deleted: number }

/**
 * Bulk-delete every invite that isn't currently available.
 * Mirrors `cleanInactiveForumInvites` — inactive predicate is
 * (redeemed_at IS NOT NULL) OR (revoked_at IS NOT NULL)
 *   OR (expires_at IS NOT NULL AND expires_at <= now()).
 */
export async function cleanInactiveInvites(): Promise<CleanInvitesResult> {
  const result = await db
    .delete(dashboardAgentInvites)
    .where(
      sql`(${dashboardAgentInvites.redeemedAt} IS NOT NULL
        OR ${dashboardAgentInvites.revokedAt} IS NOT NULL
        OR (${dashboardAgentInvites.expiresAt} IS NOT NULL AND ${dashboardAgentInvites.expiresAt} <= now()))`,
    )
    .returning({ id: dashboardAgentInvites.id })
  return { ok: true, deleted: result.length }
}

/**
 * Generate a fresh invite, hash it, persist the row, return cleartext +
 * row. The cleartext only exists outside memory at this moment; if the
 * INSERT fails we return `ok: false` so the caller never hands the
 * client entropy that wasn't actually saved.
 */
export async function issueInvite(input: IssueInviteInput): Promise<IssueInviteResult> {
  const label = input.label.trim()
  if (!label) return { ok: false, error: 'Label is required.' }
  if (label.length > LABEL_MAX) {
    return { ok: false, error: `Label must be ${LABEL_MAX} characters or fewer.` }
  }

  // 24 bytes → 32-char base64url. ~190 bits of entropy — matches
  // forum_invites; plenty for a short-lived single-use code.
  const code = randomBytes(24).toString('base64url')
  const codeHash = await argonHash(code)

  try {
    const inserted = await db
      .insert(dashboardAgentInvites)
      .values({
        label,
        codeHash,
        createdByAdminId: input.adminId,
      })
      .returning({
        id: dashboardAgentInvites.id,
        label: dashboardAgentInvites.label,
        codeHash: dashboardAgentInvites.codeHash,
        createdAt: dashboardAgentInvites.createdAt,
        expiresAt: dashboardAgentInvites.expiresAt,
        redeemedAt: dashboardAgentInvites.redeemedAt,
        redeemedTokenId: dashboardAgentInvites.redeemedTokenId,
        revokedAt: dashboardAgentInvites.revokedAt,
      })
    const row = inserted[0]
    if (!row) return { ok: false, error: 'Insert returned no row.' }
    return { ok: true, code, row }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error issuing invite.'
    return { ok: false, error: message }
  }
}

export type CheckInviteResult = { ok: true; inviteId: string } | { ok: false; reason: 'invalid' }

/**
 * Verify an invite code against unredeemed, unrevoked, unexpired rows.
 * argon2 is one-way so we linear-scan the candidate set and verify each.
 * Single `invalid` reason on miss — don't leak whether a code was ever
 * issued, expired, or already redeemed. Used by external (non-admin)
 * redemption requests, so it must reveal as little as possible.
 *
 * Note: this is the pre-flight check used by callers that want a
 * non-transactional "is this code valid?" answer. The actual redemption
 * does its OWN lookup INSIDE the transaction (with FOR UPDATE) so the
 * status read isn't TOCTOU'd by a concurrent redeem.
 */
export async function checkInviteCode(code: string): Promise<CheckInviteResult> {
  const trimmed = code.trim()
  if (!trimmed) return { ok: false, reason: 'invalid' }

  const candidates = await db
    .select({ id: dashboardAgentInvites.id, codeHash: dashboardAgentInvites.codeHash })
    .from(dashboardAgentInvites)
    .where(
      and(
        isNull(dashboardAgentInvites.redeemedAt),
        isNull(dashboardAgentInvites.revokedAt),
        or(
          isNull(dashboardAgentInvites.expiresAt),
          gt(dashboardAgentInvites.expiresAt, new Date()),
        ),
      ),
    )

  for (const c of candidates) {
    if (await argonVerify(trimmed, c.codeHash)) {
      return { ok: true, inviteId: c.id }
    }
  }
  return { ok: false, reason: 'invalid' }
}

export type RedeemInviteResult =
  | { ok: true; token: string; tokenId: string; label: string }
  | { ok: false; reason: 'invalid_code' | 'db_error' }

/**
 * Atomically redeem an invite for a fresh agent token.
 *
 * Flow inside a single transaction:
 *   1. Linear-scan candidate invites and find the one matching `code`
 *      via argon2 verify. (Same shape as `checkInviteCode` but done
 *      inline so we can re-verify status inside the lock.)
 *   2. SELECT the matched invite FOR UPDATE — locks the row so no
 *      concurrent redeem can also use it.
 *   3. TOCTOU re-check: redeemed_at IS NULL, revoked_at IS NULL,
 *      expires_at NULL or in the future. Any failure → return
 *      'invalid_code' (don't leak why).
 *   4. Generate 32 random bytes → base64url cleartext (256 bits
 *      entropy, matches `issueToken` in agent-tokens-repo). Hash with
 *      argon2id.
 *   5. INSERT new `agent_tokens` row with the invite's label and the
 *      fresh token hash, returning the new id.
 *   6. UPDATE invite SET redeemed_at = now(), redeemed_token_id = <new id>.
 *   7. Return cleartext token + new token id + label.
 *
 * On any DB error during the transaction, drizzle rolls back — no
 * partial rows, no cleartext leaked.
 */
export async function redeemInvite(code: string): Promise<RedeemInviteResult> {
  const trimmed = code.trim()
  if (!trimmed) return { ok: false, reason: 'invalid_code' }

  try {
    return await db.transaction(async (tx) => {
      // Step 1: find the matching candidate by argon2 verify.
      const candidates = await tx
        .select({
          id: dashboardAgentInvites.id,
          codeHash: dashboardAgentInvites.codeHash,
        })
        .from(dashboardAgentInvites)
        .where(
          and(
            isNull(dashboardAgentInvites.redeemedAt),
            isNull(dashboardAgentInvites.revokedAt),
            or(
              isNull(dashboardAgentInvites.expiresAt),
              gt(dashboardAgentInvites.expiresAt, new Date()),
            ),
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

      // Step 2: lock the invite row FOR UPDATE.
      const lockedRows = await tx.execute<{
        id: string
        label: string
        redeemed_at: Date | null
        revoked_at: Date | null
        expires_at: Date | null
      }>(
        sql`SELECT id, label, redeemed_at, revoked_at, expires_at
            FROM ${dashboardAgentInvites}
            WHERE id = ${matchedId}
            FOR UPDATE`,
      )
      const locked = (
        lockedRows as unknown as Array<{
          id: string
          label: string
          redeemed_at: Date | null
          revoked_at: Date | null
          expires_at: Date | null
        }>
      )[0]
      if (!locked) {
        return { ok: false, reason: 'invalid_code' } as const
      }

      // Step 3: TOCTOU re-check inside the lock.
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

      // Step 4: mint the cleartext token + hash.
      const cleartext = randomBytes(32).toString('base64url')
      const tokenHash = await argonHash(cleartext)

      // Step 5: insert agent_tokens row with the invite's label.
      const insertedTokens = await tx
        .insert(agentTokens)
        .values({
          label: locked.label,
          tokenHash,
        })
        .returning({
          id: agentTokens.id,
          label: agentTokens.label,
        })
      const newToken = insertedTokens[0]
      if (!newToken) {
        // Drizzle throws on failed inserts, but guard the type narrowing.
        throw new Error('agent_tokens insert returned no row')
      }

      // Step 6: stamp the invite as redeemed.
      await tx
        .update(dashboardAgentInvites)
        .set({
          redeemedAt: sql`now()`,
          redeemedTokenId: newToken.id,
        })
        .where(eq(dashboardAgentInvites.id, matchedId))

      // Step 7: cleartext exits the module exactly once, here.
      return {
        ok: true,
        token: cleartext,
        tokenId: newToken.id,
        label: newToken.label,
      } as const
    })
  } catch (_err) {
    // Never log cleartext. The error itself shouldn't contain the
    // code, but be paranoid and don't echo `err` to logs from here —
    // the route handler will return a generic db_error.
    return { ok: false, reason: 'db_error' }
  }
}

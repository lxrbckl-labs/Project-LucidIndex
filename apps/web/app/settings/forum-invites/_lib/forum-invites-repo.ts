/**
 * Server-only data helpers for the Settings → Forum Invites panel.
 *
 * Mirror of agent-tokens-repo: cleartext is shown ONCE at creation, only
 * the argon2 hash lives in the DB. Phase C will add a `redeemInvite()`
 * helper that consumes a code in the signup transaction.
 */

import { randomBytes } from 'node:crypto'
import { hashCode as argonHash, verifyHash as argonVerify } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { and, desc, eq, gt, isNull, or, sql } from '@lucidindex/db/query'
import { forumInvites } from '@lucidindex/db/schema'

export const LABEL_MAX = 100

export type ForumInviteRow = {
  id: string
  label: string
  codeHash: string
  createdAt: Date
  expiresAt: Date | null
  redeemedAt: Date | null
  redeemedByUserId: string | null
  revokedAt: Date | null
}

export type IssueInviteInput = {
  label: string
  adminId: string | null
}

export type IssueInviteResult =
  | { ok: true; code: string; row: ForumInviteRow }
  | { ok: false; error: string }

export type InviteStatus = 'available' | 'redeemed' | 'expired' | 'revoked'

export function deriveInviteStatus(row: ForumInviteRow, now: Date = new Date()): InviteStatus {
  // Revocation wins over redemption — the invite acts as a persistent
  // permission anchor for the user it minted, so revoking a redeemed
  // invite is the admin's kill-switch on that user's login. The
  // redeemed_at timestamp stays in the row for audit (surfaced in the
  // "Redeemed" column) — we just stop reporting the row as 'redeemed'
  // because access is now denied.
  if (row.revokedAt) return 'revoked'
  if (row.redeemedAt) return 'redeemed'
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'available'
}

/** List every invite, newest first. Never returns cleartexts. */
export async function listForumInvites(): Promise<ForumInviteRow[]> {
  const rows = await db
    .select({
      id: forumInvites.id,
      label: forumInvites.label,
      codeHash: forumInvites.codeHash,
      createdAt: forumInvites.createdAt,
      expiresAt: forumInvites.expiresAt,
      redeemedAt: forumInvites.redeemedAt,
      redeemedByUserId: forumInvites.redeemedByUserId,
      revokedAt: forumInvites.revokedAt,
    })
    .from(forumInvites)
    .orderBy(desc(forumInvites.createdAt))
  return rows
}

/**
 * Revoke an invite — the admin's kill-switch. Idempotent: calling twice
 * on an already-revoked row is a no-op. Works whether or not the invite
 * has been redeemed:
 *   - Unredeemed → the signup link stops working.
 *   - Redeemed   → the linked forum_user is locked out of login. Their
 *     account row, posts, and replies stay (audit), but auth must check
 *     `forum_invites.revoked_at IS NULL` for the user's invite on every
 *     request to enforce the lockout.
 * No "unrevoke" — to re-grant access, issue a fresh invite and have the
 * user sign up again.
 */
export type RevokeInviteResult =
  | { ok: true; alreadyRevoked: boolean }
  | { ok: false; reason: 'not_found' }

export async function revokeForumInvite(id: string): Promise<RevokeInviteResult> {
  const rows = await db
    .select({
      id: forumInvites.id,
      revokedAt: forumInvites.revokedAt,
    })
    .from(forumInvites)
    .where(eq(forumInvites.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.revokedAt) return { ok: true, alreadyRevoked: true }

  await db.update(forumInvites).set({ revokedAt: sql`now()` }).where(eq(forumInvites.id, id))
  return { ok: true, alreadyRevoked: false }
}

/**
 * Restore a revoked invite — clears `revoked_at` back to NULL. Idempotent
 * on a row that's already active. The row's `redeemed_at` is preserved
 * if set, so a redeemed-then-revoked-then-restored invite returns to its
 * 'redeemed' status (and the linked user's login works again).
 *
 * Note: this leaves no trace in the row itself that a revoke→restore
 * round-trip happened. Daily logs are the audit surface for that.
 */
export type UnrevokeInviteResult =
  | { ok: true; alreadyActive: boolean }
  | { ok: false; reason: 'not_found' }

export async function unrevokeForumInvite(id: string): Promise<UnrevokeInviteResult> {
  const rows = await db
    .select({
      id: forumInvites.id,
      revokedAt: forumInvites.revokedAt,
    })
    .from(forumInvites)
    .where(eq(forumInvites.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (!row.revokedAt) return { ok: true, alreadyActive: true }

  await db.update(forumInvites).set({ revokedAt: null }).where(eq(forumInvites.id, id))
  return { ok: true, alreadyActive: false }
}

/**
 * Hard-delete an invite row. Refuses if the invite is still "available"
 * (could still be redeemed) — admins must revoke first to put the row
 * into a deletable terminal state.
 *
 * Side-effect to be aware of: deleting a *redeemed* invite removes the
 * `forum_invites` row that `finishForumLogin` uses as the kill-switch
 * anchor. The linked forum_user's row stays (and so do their posts /
 * replies via FK preservation), but login refuses with `no_invite_anchor`
 * — effectively a permanent lockout. The UI confirm dialog calls this
 * out for redeemed rows.
 */
export type DeleteInviteResult = { ok: true } | { ok: false; reason: 'not_found' | 'still_active' }

export async function deleteForumInvite(id: string): Promise<DeleteInviteResult> {
  const rows = await db
    .select({
      id: forumInvites.id,
      redeemedAt: forumInvites.redeemedAt,
      revokedAt: forumInvites.revokedAt,
      expiresAt: forumInvites.expiresAt,
    })
    .from(forumInvites)
    .where(eq(forumInvites.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }

  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()
  const inactive = row.redeemedAt !== null || row.revokedAt !== null || expired
  if (!inactive) return { ok: false, reason: 'still_active' }

  await db.delete(forumInvites).where(eq(forumInvites.id, id))
  return { ok: true }
}

/**
 * Bulk delete every invite that isn't currently available. Matches the
 * "inactive" predicate the Delete button uses on individual rows:
 *   redeemed_at IS NOT NULL OR revoked_at IS NOT NULL
 *     OR (expires_at IS NOT NULL AND expires_at <= now())
 *
 * Same kill-switch caveat as the single-row delete — any redeemed
 * invites swept up here will lock out their linked forum_users on
 * next sign-in.
 */
export type CleanInvitesResult = { ok: true; deleted: number }

export async function cleanInactiveForumInvites(): Promise<CleanInvitesResult> {
  const result = await db
    .delete(forumInvites)
    .where(
      sql`(${forumInvites.redeemedAt} IS NOT NULL
        OR ${forumInvites.revokedAt} IS NOT NULL
        OR (${forumInvites.expiresAt} IS NOT NULL AND ${forumInvites.expiresAt} <= now()))`,
    )
    .returning({ id: forumInvites.id })
  return { ok: true, deleted: result.length }
}

/**
 * Generate a fresh invite code, hash it, persist the row, and return the
 * cleartext + the row to the caller. The cleartext is the ONLY moment it
 * exists outside of memory; if the DB insert fails we return `ok: false`
 * so we never hand the user entropy that wasn't actually saved.
 */
export async function issueForumInvite(input: IssueInviteInput): Promise<IssueInviteResult> {
  const label = input.label.trim()
  if (!label) return { ok: false, error: 'Label is required.' }
  if (label.length > LABEL_MAX) {
    return { ok: false, error: `Label must be ${LABEL_MAX} characters or fewer.` }
  }

  // 24 bytes → 32-char base64url. ~190 bits of entropy is plenty for an
  // invite — they're short-lived single-use codes, not session secrets.
  const code = randomBytes(24).toString('base64url')
  const codeHash = await argonHash(code)

  try {
    const inserted = await db
      .insert(forumInvites)
      .values({
        label,
        codeHash,
        createdByAdminId: input.adminId,
      })
      .returning({
        id: forumInvites.id,
        label: forumInvites.label,
        codeHash: forumInvites.codeHash,
        createdAt: forumInvites.createdAt,
        expiresAt: forumInvites.expiresAt,
        redeemedAt: forumInvites.redeemedAt,
        redeemedByUserId: forumInvites.redeemedByUserId,
        revokedAt: forumInvites.revokedAt,
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
 * Verify an invite code against unredeemed, unexpired rows. argon2 is
 * one-way so we linear-scan the candidate set and verify each — fine at
 * homelab scale. The result is intentionally narrow: a hit returns the
 * invite id (so the redeem step can target it atomically); a miss is a
 * single `invalid` reason regardless of why (don't leak whether a code
 * was ever issued, expired, or already redeemed).
 */
export async function checkInviteCode(code: string): Promise<CheckInviteResult> {
  const trimmed = code.trim()
  if (!trimmed) return { ok: false, reason: 'invalid' }

  const candidates = await db
    .select({ id: forumInvites.id, codeHash: forumInvites.codeHash })
    .from(forumInvites)
    .where(
      and(
        isNull(forumInvites.redeemedAt),
        isNull(forumInvites.revokedAt),
        or(isNull(forumInvites.expiresAt), gt(forumInvites.expiresAt, new Date())),
      ),
    )

  for (const c of candidates) {
    if (await argonVerify(trimmed, c.codeHash)) {
      return { ok: true, inviteId: c.id }
    }
  }
  return { ok: false, reason: 'invalid' }
}

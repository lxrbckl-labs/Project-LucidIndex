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
  // Redemption is the strongest terminal state — if the invite was used,
  // surface that even if it was later revoked.
  if (row.redeemedAt) return 'redeemed'
  if (row.revokedAt) return 'revoked'
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
 * Revoke an unredeemed invite. Idempotent in the sense that calling it
 * twice on an already-revoked row is a no-op (returns ok: true). If the
 * invite is already redeemed we leave revoked_at null and return an error
 * — redemption is the stronger terminal state and shouldn't be papered
 * over.
 */
export type RevokeInviteResult =
  | { ok: true; alreadyRevoked: boolean }
  | { ok: false; reason: 'not_found' | 'already_redeemed' }

export async function revokeForumInvite(id: string): Promise<RevokeInviteResult> {
  const rows = await db
    .select({
      id: forumInvites.id,
      redeemedAt: forumInvites.redeemedAt,
      revokedAt: forumInvites.revokedAt,
    })
    .from(forumInvites)
    .where(eq(forumInvites.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.redeemedAt) return { ok: false, reason: 'already_redeemed' }
  if (row.revokedAt) return { ok: true, alreadyRevoked: true }

  await db.update(forumInvites).set({ revokedAt: sql`now()` }).where(eq(forumInvites.id, id))
  return { ok: true, alreadyRevoked: false }
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

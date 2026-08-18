/**
 * Pure types + status derivation for forum agent invites.
 *
 * No 'use client', no DB imports — importable from both the server page
 * (RSC, force-dynamic) and the client components. `deriveStatus` uses
 * `Date.now()`, which is fine server-side because the page is dynamic.
 */

export type InviteRowClient = {
  id: string
  label: string
  agentUsername: string
  codeHash: string
  createdAt: string
  expiresAt: string | null
  redeemedAt: string | null
  redeemedTokenId: string | null
  revokedAt: string | null
  /**
   * Mirror of `forum_agent_tokens.revoked_at` on the row's redeemed
   * token. Populated only when `redeemedTokenId` is non-null. The
   * invite-side `revokedAt` is an audit marker; THIS is the field
   * that controls whether the agent's bearer still works.
   */
  tokenRevokedAt: string | null
}

export type Status = 'available' | 'redeemed' | 'expired' | 'revoked'

export function deriveStatus(row: InviteRowClient): Status {
  if (row.revokedAt) return 'revoked'
  if (row.redeemedAt) return 'redeemed'
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return 'expired'
  return 'available'
}

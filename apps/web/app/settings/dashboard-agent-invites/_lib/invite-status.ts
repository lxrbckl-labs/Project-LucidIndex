/**
 * Pure types + status derivation for dashboard agent invites.
 *
 * No 'use client', no DB imports — importable from both the server page
 * (RSC, force-dynamic) and the client components. `deriveStatus` uses
 * `Date.now()`, which is fine server-side because the page is dynamic.
 */

export type InviteRowClient = {
  id: string
  label: string
  codeHash: string
  createdAt: string
  expiresAt: string | null
  redeemedAt: string | null
  redeemedTokenId: string | null
  revokedAt: string | null
}

export type Status = 'available' | 'redeemed' | 'expired' | 'revoked'

export function deriveStatus(row: InviteRowClient): Status {
  if (row.revokedAt) return 'revoked'
  if (row.redeemedAt) return 'redeemed'
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return 'expired'
  return 'available'
}

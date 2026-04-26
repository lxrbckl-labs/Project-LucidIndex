/**
 * Account-level read helpers.
 *
 * Thin data-fetching functions for the Settings → Account panel.
 * Kept separate from the write flows (register.ts, recovery-actions.ts) so
 * the server component can import just what it needs.
 */

import { db } from '@lucidindex/db/client'
import { credentials } from '@lucidindex/db/schema'
import { eq } from 'drizzle-orm'

export type CredentialSummary = {
  id: string
  deviceLabel: string
  createdAt: Date
}

/**
 * Return the credential summaries (id, deviceLabel, createdAt) for an admin,
 * ordered by creation time ascending (oldest first).
 */
export async function getAdminCredentials(adminId: string): Promise<CredentialSummary[]> {
  const rows = await db
    .select({
      id: credentials.id,
      deviceLabel: credentials.deviceLabel,
      createdAt: credentials.createdAt,
    })
    .from(credentials)
    .where(eq(credentials.adminId, adminId))
    .orderBy(credentials.createdAt)
  return rows
}

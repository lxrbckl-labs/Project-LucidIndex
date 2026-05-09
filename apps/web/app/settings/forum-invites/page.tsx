/**
 * Settings → Forum Invites — RSC.
 *
 * Loads the invite list and hands it to the client panel. Cleartext codes
 * are never persisted server-side; this page only ever ships hashes +
 * metadata to the browser.
 */

import { ForumInvitesPanel, type InviteRowClient } from './_components/ForumInvitesPanel'
import { listForumInvites } from './_lib/forum-invites-repo'

export const dynamic = 'force-dynamic'

export default async function ForumInvitesPage() {
  const rows = await listForumInvites()
  const initialInvites: InviteRowClient[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    codeHash: r.codeHash,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
    redeemedByUserId: r.redeemedByUserId,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  }))

  return <ForumInvitesPanel initialInvites={initialInvites} />
}

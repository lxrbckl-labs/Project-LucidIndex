/**
 * Settings → Dashboard → Agents.
 *
 * Surface for the admin to mint single-use invite codes that another
 * person's *agent* (not a human user) redeems to authorize a session
 * against our Dashboard MCP server. Once redeemed, the agent reaches
 * the Dashboard MCP endpoint with its bearer token and discovers the
 * tool surface from there.
 *
 * Sibling of /settings/agent-invites, which authorizes agents against
 * the *forum* MCP server. The two are intentionally separate because
 * the two MCP servers expose different tool surfaces and the threat
 * model + scopes differ.
 */

import type { Metadata } from 'next'
import {
  DashboardAgentInvitesPanel,
  type InviteRowClient,
} from './_components/DashboardAgentInvitesPanel'
import { listInvites } from './_lib/dashboard-agent-invites-repo'

export const metadata: Metadata = {
  title: 'Agents — Dashboard — Settings — LucidIndex',
}

export const dynamic = 'force-dynamic'

export default async function DashboardAgentInvitesPage() {
  const rows = await listInvites()
  const initialInvites: InviteRowClient[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    codeHash: r.codeHash,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
    redeemedTokenId: r.redeemedTokenId,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  }))

  return (
    <>
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Mint one-time invite codes for external agent operators. On redemption, the agent gets a
            bearer token authorized against the dashboard MCP server. Each code is shown in
            plaintext exactly once at creation and kept for audit after redemption or revocation.
          </p>
        </div>
      </div>
      <DashboardAgentInvitesPanel initialInvites={initialInvites} />
    </>
  )
}

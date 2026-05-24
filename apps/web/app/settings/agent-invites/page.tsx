/**
 * Settings → Forum → Agents.
 *
 * Surface for the admin to mint single-use invite codes that another
 * person's *agent* (not a human user) redeems to authorize a session
 * against our forum MCP server (`apps/mcp-forum`). Each invite pre-bakes
 * the agent's forum handle, and redemption atomically mints both the
 * forum user identity and the bearer token in a single DB transaction.
 *
 * Sibling of /settings/forum-invites (which gates human signup) and
 * /settings/dashboard-agent-invites (which authorizes agents against
 * the Dashboard MCP server). The three are intentionally separate
 * because the threat models + lifecycles differ.
 */

import type { Metadata } from 'next'
import { AgentInvitesPanel, type InviteRowClient } from './_components/AgentInvitesPanel'
import { listInvites } from './_lib/agent-invites-repo'

export const metadata: Metadata = {
  title: 'Agents — Settings — LucidIndex',
}

export const dynamic = 'force-dynamic'

export default async function AgentInvitesPage() {
  const rows = await listInvites()
  const initialInvites: InviteRowClient[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    agentUsername: r.agentUsername,
    codeHash: r.codeHash,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
    redeemedTokenId: r.redeemedTokenId,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    tokenRevokedAt: r.tokenRevokedAt ? r.tokenRevokedAt.toISOString() : null,
  }))

  return (
    <>
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-b flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Mint one-time invite codes for external agent operators. On redemption, the agent gets a
            bearer token AND a forum user identity, authorized against the forum MCP server. Each
            code is shown in plaintext exactly once at creation and kept for audit after redemption
            or revocation.
          </p>
        </div>
      </div>
      <AgentInvitesPanel initialInvites={initialInvites} />
    </>
  )
}

/**
 * Settings → Dashboard → Agent Invites.
 *
 * Surface for the admin to mint signed invite tokens that another
 * person's *agent* (not a human user) redeems to authorize a session
 * against our Dashboard MCP server. Once redeemed, the agent reaches
 * the Dashboard MCP endpoint and discovers the tool surface from there.
 *
 * Placeholder until the schema + token-mint flow lands. Sibling of
 * /settings/agent-invites, which authorizes agents against the *forum*
 * MCP server. The two are intentionally separate because the two MCP
 * servers expose different tool surfaces and the threat model + scopes
 * differ.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Agent Invites — Dashboard — Settings — LucidIndex',
}

export const dynamic = 'force-dynamic'

export default function DashboardAgentInvitesPage() {
  return (
    <>
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agent Invites</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Tokens you mint and share so another person's agent can authorize a session against this
            LucidIndex's Dashboard MCP server. Each token is shown in plaintext exactly once at
            creation and kept for audit after redemption or revocation.
          </p>
        </div>
      </div>

      {/* Future: list + mint/revoke surface for Dashboard MCP authorization. */}
    </>
  )
}

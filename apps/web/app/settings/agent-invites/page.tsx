/**
 * Settings → Agent Invites.
 *
 * Surface for the admin to mint signed invite tokens that another
 * person's *agent* (not a human user) redeems to authorize a session
 * against our forum MCP server (`apps/mcp-forum`). Once redeemed, the
 * agent reaches the forum MCP endpoint with its bearer token and
 * discovers the tool surface from there.
 *
 * Backing schema lives in `packages/db/schema/forum.ts` —
 * `forum_agent_tokens` (FK to `forum_users` with is_agent=true). The
 * mint/list/revoke UI is the next step; for now the row can be
 * created manually for development.
 *
 * Sibling of /settings/forum-invites (which is for human forum-user
 * signup); the two are intentionally separate because the threat
 * model + lifecycle differ — a forum-MCP token authorizes
 * participation as a specific agent forum_user, a human invite
 * authorizes a WebAuthn-paired human session.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Agent Invites — Settings — LucidIndex',
}

export const dynamic = 'force-dynamic'

export default function AgentInvitesPage() {
  return (
    <>
      <div className="-mx-6 -mt-6 px-6 pt-6 pb-6 border-t border-b flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agent Invites</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Tokens you mint and share so another person's agent can authorize a session against this
            forum's MCP server. Each token is shown in plaintext exactly once at creation and kept
            for audit after redemption or revocation.
          </p>
        </div>
      </div>

      {/* Future: list + mint/revoke surface, sibling of ForumInvitesPanel. */}
    </>
  )
}

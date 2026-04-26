/**
 * Settings → Agent Tokens (Phase 2 — closes #35).
 *
 * Server component: loads the full token list from the DB (no cleartexts —
 * those are gone after issue time) then hands it to `<AgentTokensPanel>` for
 * interactive rendering: Issue, display-once, Revoke.
 *
 * Auth is handled by `apps/web/app/settings/layout.tsx` — this page only
 * renders for an authenticated admin.
 */

import { db } from '@lucidindex/db/client'
import { desc } from '@lucidindex/db/query'
import { agentTokens } from '@lucidindex/db/schema'
import { AgentTokensPanel, type TokenRowClient } from './_components/AgentTokensPanel'

export const dynamic = 'force-dynamic'

export default async function AgentTokensPanelPage() {
  const rows = await db
    .select({
      id: agentTokens.id,
      label: agentTokens.label,
      tokenHash: agentTokens.tokenHash,
      createdAt: agentTokens.createdAt,
      revokedAt: agentTokens.revokedAt,
    })
    .from(agentTokens)
    .orderBy(desc(agentTokens.createdAt))

  const initialTokens: TokenRowClient[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    tokenHash: r.tokenHash,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  }))

  return <AgentTokensPanel initialTokens={initialTokens} />
}

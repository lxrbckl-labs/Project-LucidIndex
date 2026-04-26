import { PanelPlaceholder } from '../_components/PanelPlaceholder'

export default function AgentTokensPanelPage() {
  return (
    <PanelPlaceholder
      title="Agent tokens"
      phase="Phase 2 — coming in #35"
      summary="Issue, display once, hash, and revoke agent tokens."
    >
      <p>
        The full lifecycle (issue → display once → store hash → revoke) for tokens consumed by
        headless agents lands in ticket #35.
      </p>
    </PanelPlaceholder>
  )
}

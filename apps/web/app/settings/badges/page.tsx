import { PanelPlaceholder } from '../_components/PanelPlaceholder'

export default function BadgesPanelPage() {
  return (
    <PanelPlaceholder
      title="Badges"
      phase="Phase 2 — coming in #33"
      summary="Curated badges, agent-suggested inbox, and bulk actions."
    >
      <p>
        Badge CRUD, the suggestion inbox where the agent proposes new badges based on read articles,
        and bulk apply / remove actions land in ticket #33.
      </p>
    </PanelPlaceholder>
  )
}

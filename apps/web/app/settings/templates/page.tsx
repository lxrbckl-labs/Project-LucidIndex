import { PanelPlaceholder } from '../_components/PanelPlaceholder'

export default function TemplatesPanelPage() {
  return (
    <PanelPlaceholder
      title="Templates"
      phase="Phase 2 — coming in #34"
      summary="Prompt templates with Liquid validation."
    >
      <p>
        Template CRUD, Liquid syntax validation against the LucidIndex variable surface, and the
        starter-template library land in ticket #34.
      </p>
    </PanelPlaceholder>
  )
}

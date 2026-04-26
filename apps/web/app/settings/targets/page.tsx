import { PanelPlaceholder } from '../_components/PanelPlaceholder'

export default function TargetsPanelPage() {
  return (
    <PanelPlaceholder
      title="Targets"
      phase="Phase 2 — coming in #32"
      summary="Curate the sources LucidIndex crawls."
    >
      <p>
        Full target CRUD (add, edit, pause, archive) lands in ticket #32. The first iteration will
        cover RSS/Atom feeds and arbitrary URLs.
      </p>
    </PanelPlaceholder>
  )
}
